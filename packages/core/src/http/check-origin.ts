import type { AuthConfig } from "../core/auth-config"
import type { AuthInternals } from "../core/auth-internals"
import { getRequestOrigin } from "../lib/get-base-url"
import { AuthApiError } from "./auth-api-error"

/** Methods that must not have side effects, and so need no origin check. */
export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

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
 * The forwarded origin joins it only under `trustedProxyHeaders`, for the same
 * reason it is what the redirect URI is built from: behind a proxy the URL the
 * runtime sees is internal while the browser names the public origin, and the
 * two only meet in `X-Forwarded-Host`. Off by default because an origin taken
 * from the request cannot also be what the request is checked against — that is
 * a caller nominating its own permission. `baseURL` is allowed whenever one is
 * configured, and every entry in `trustedOrigins` because that option exists to
 * say so.
 */
function allowedOrigins(config: AuthConfig, request: Request) {
  const allowed = new Set<string>()
  const self = originOf(request.url)
  if (self) allowed.add(self)
  const forwarded = getRequestOrigin(
    request.url,
    request.headers,
    config.trustedProxyHeaders
  )
  if (forwarded) allowed.add(forwarded)
  if (config.baseURL) {
    const base = originOf(config.baseURL)
    if (base) allowed.add(base)
  }
  for (const trusted of config.trustedOrigins) {
    allowed.add(trusted)
    const parsed = originOf(trusted)
    if (parsed) allowed.add(parsed)
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
 * stripped it), and one that is not this server's own — as the runtime sees it
 * or as a proxy forwarded it — nor its `baseURL`, nor its configured
 * `trustedOrigins`, is refused. A request with neither header passes:
 * its absence means a non-browser client, which holds no cookie and so cannot
 * be made to act on someone's behalf. That is the one way this check fails open.
 *
 * **A body must be JSON.** A page cannot send `application/json` cross-origin
 * without a preflight, so a browser stops most of these before any header
 * reaches the server. That is a bonus rather than the guarantee — whoever
 * answers the preflight is the application's business, so this check does not
 * depend on it and runs on every request regardless. It costs nothing: the client and
 * any JSON caller already send it. Bodiless requests are untouched, because
 * they have no content type to check and nothing dangerous to carry.
 *
 * Both run before the body is parsed, so a refused request does no work.
 *
 * @throws {AuthApiError} `forbiddenOrigin` (403) for a disallowed origin;
 * `unsupportedMediaType` (415) for a body that is not JSON.
 */
export function assertAllowedOrigin(
  internals: AuthInternals,
  request: Request
) {
  if (SAFE_METHODS.has(request.method)) return

  const origin =
    request.headers.get("origin") ??
    originOf(request.headers.get("referer") ?? "")
  if (
    origin !== null &&
    !allowedOrigins(internals.config, request).has(origin)
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
