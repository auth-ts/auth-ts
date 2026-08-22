import type { AuthServerConfig } from "../core/auth-server-config.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import { AuthApiError } from "./auth-api-error.ts"

/** Methods that must not have side effects, and so need no origin check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Whether a request carries a body, judged from its headers.
 *
 * Not from `request.body`: some server adapters attach an empty stream to
 * every `POST`, which would make a bodiless call from the client look like a
 * body with no type. And not from `Content-Type` alone: a typeless `Blob` is
 * sent with no content type at all but still with a length, which is exactly
 * how a page would try to slip a body past a content-type rule.
 */
function carriesBody(headers: Headers) {
  return (
    headers.has("content-type") ||
    Number(headers.get("content-length")) > 0 ||
    headers.has("transfer-encoding")
  )
}

/** Parses a URL's origin, or `null` when it is not a URL at all. */
function originOf(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * The origins allowed to make state-changing requests.
 *
 * The request's own origin is always allowed — that is the same-origin case.
 * `baseURL` is allowed because behind a proxy the request URL the runtime
 * sees may be internal while the browser names the public origin. `cors.origin`
 * is allowed because it is, by configuration, the one other origin this server
 * serves.
 */
function allowedOrigins(config: AuthServerConfig, requestURL: string) {
  const allowed = new Set<string>()
  const self = originOf(requestURL)
  if (self) allowed.add(self)
  if (config.baseURL) {
    const base = originOf(config.baseURL)
    if (base) allowed.add(base)
  }
  if (config.cors) {
    allowed.add(config.cors.origin)
    const cors = originOf(config.cors.origin)
    if (cors) allowed.add(cors)
  }
  return allowed
}

/**
 * Refuses a state-changing request from an origin this server does not serve.
 *
 * CORS headers decide whether a page may *read* a response; they do not stop the
 * browser from *sending* the request, and a `POST` with a simple content type
 * goes out without a preflight, cookie attached. `SameSite=Lax` confines that
 * to the same site, which still leaves a sibling subdomain — or a browser that
 * does not enforce it — able to sign the user out, sign them into someone
 * else's account, or have a guest's session merged into an attacker's. Two
 * checks close it, and they fail in different directions on purpose:
 *
 * **The origin must be served here.** The browser stamps every cross-origin
 * `POST` with `Origin` (`Referer` is consulted when a privacy setting has
 * stripped it), and one that is not this server's own, its `baseURL`, or its
 * configured `cors.origin` is refused. A request with neither header passes:
 * its absence means a non-browser client — a native app or CLI using
 * `mode: "token"` — which holds no cookie and so cannot be made to act on
 * someone's behalf. That is the one way this check fails open.
 *
 * **A body must be JSON.** A page cannot send `application/json` cross-origin
 * without a preflight, and the preflight approves only `cors.origin` — so this
 * is enforced by the browser itself, before any header reaches the server, and
 * holds even when `Origin` has been stripped. It costs nothing: the client and
 * any JSON caller already send it. Bodiless requests are untouched, because
 * they have no content type to check and nothing dangerous to carry.
 *
 * Both run before the body is parsed, so a refused request does no work.
 *
 * @throws {AuthApiError} `forbiddenOrigin` (403) for a disallowed origin;
 * `unsupportedMediaType` (415) for a body that is not JSON.
 */
export function assertAllowedOrigin(
  internals: AuthServerInternals,
  request: Request
) {
  if (SAFE_METHODS.has(request.method)) return

  const origin =
    request.headers.get("origin") ??
    originOf(request.headers.get("referer") ?? "")
  if (
    origin !== null &&
    !allowedOrigins(internals.config, request.url).has(origin)
  ) {
    internals.log.warn("refused a request from a disallowed origin", {
      origin
    })
    throw new AuthApiError("forbiddenOrigin", 403)
  }

  if (carriesBody(request.headers)) {
    const contentType = request.headers.get("content-type") ?? ""
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      internals.log.warn("refused a request body that is not JSON", {
        contentType: contentType.split(";")[0] ?? ""
      })
      throw new AuthApiError("unsupportedMediaType", 415)
    }
  }
}
