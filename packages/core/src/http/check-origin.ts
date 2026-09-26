import type { AuthConfig } from "../core/auth-config"
import type { AuthInternals } from "../core/auth-internals"
import { getRequestOrigin } from "../lib/get-base-url"
import { AuthApiError } from "./auth-api-error"

/** Methods that must not have side effects, and so need no origin check. */
export const SAFE_METHODS = new Set(["GET", "HEAD"])

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
function isAllowedOrigin(config: AuthConfig, request: Request, origin: string) {
  return (
    origin === originOf(request.url) ||
    origin ===
      getRequestOrigin(
        request.url,
        request.headers,
        config.trustedProxyHeaders
      ) ||
    configuredOrigins(config).has(origin)
  )
}

const configuredOriginsByConfig = new WeakMap<AuthConfig, Set<string>>()

/** The origins fixed by configuration, built once per server. */
function configuredOrigins(config: AuthConfig) {
  const cached = configuredOriginsByConfig.get(config)
  if (cached) return cached

  const origins = new Set<string>()
  const base = config.baseURL ? originOf(config.baseURL) : null
  if (base) origins.add(base)
  for (const trusted of config.trustedOrigins) {
    origins.add(trusted)
    const parsed = originOf(trusted)
    if (parsed) origins.add(parsed)
  }
  configuredOriginsByConfig.set(config, origins)
  return origins
}

/**
 * Refuses a state-changing request that did not come from this site.
 *
 * The book's check, as in Lucia's `auth_session.ts` and the author's
 * `actionRoute`: every non-GET request must carry `Sec-Fetch-Site:
 * same-origin`. The browser sets that header on every request and forbids a
 * page from touching it, so a cross-site page cannot forge it; and a browser
 * too old to send it is refused rather than trusted, which is what makes
 * "missing" a refusal. Cross-site request forgery is a browser attack — a
 * client that is not a browser may set the header itself, and the
 * `cookieStorage` client does.
 *
 * The book's one fallback, for subdomains and older browsers, is an explicit
 * `Origin` allowlist. That is what lets a request whose header says
 * `same-site` or `cross-site` — or that has no header at all — through: only
 * when its `Origin` is this server's own, as the runtime sees it or as a
 * trusted proxy forwarded it, its `baseURL`, or one of its `trustedOrigins`.
 *
 * A body, when there is one, must be `application/json`, with `utf-8` as the
 * only charset a parameter may name — the author's check. A page cannot send
 * that content type cross-site without a preflight, so the browser stops most
 * of these before any header reaches the server; the check runs regardless,
 * because whoever answers the preflight is the application's business.
 *
 * Both run before the body is parsed, so a refused request does no work.
 *
 * @throws {AuthApiError} `forbiddenOrigin` (403) for a request that is not
 * same-origin and not from an allowlisted origin; `unsupportedMediaType` (415)
 * for a body that is not JSON.
 */
export function assertAllowedOrigin(
  internals: AuthInternals,
  request: Request
) {
  if (SAFE_METHODS.has(request.method)) return

  // Lucia's auth_session.ts, 0BSD
  const secFetchSiteHeader = request.headers.get("Sec-Fetch-Site")
  if (secFetchSiteHeader !== "same-origin") {
    const origin = request.headers.get("origin")
    if (
      origin === null ||
      !isAllowedOrigin(internals.config, request, origin)
    ) {
      internals.log.warn("refused a request that is not same-origin", {
        secFetchSite: secFetchSiteHeader,
        origin
      })
      throw new AuthApiError("forbiddenOrigin")
    }
  }

  if (carriesBody(request.headers)) {
    const [mediaType = "", ...parameters] = (
      request.headers.get("content-type") ?? ""
    ).split(";")
    const charset = parameters
      .map((parameter) => parameter.trim().split("="))
      .find(([name]) => name?.trim().toLowerCase() === "charset")?.[1]
      ?.trim()
      .replace(/^"(.*)"$/, "$1")
    if (
      mediaType.trim().toLowerCase() !== "application/json" ||
      (charset !== undefined && charset.toLowerCase() !== "utf-8")
    ) {
      internals.log.warn("refused a request body that is not JSON", {
        contentType: mediaType.trim()
      })
      throw new AuthApiError("unsupportedMediaType")
    }
  }
}
