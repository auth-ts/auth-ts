import type { AuthConfig } from "../core/auth-config"
import type { AuthInternals } from "../core/auth-internals"
import { getRequestOrigin } from "../lib/get-base-url"
import { isBearerTransport } from "../shared/session-transport"
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

/** Ambient cookies require trusted browser origins. */
export function assertAllowedOrigin(
  internals: AuthInternals,
  request: Request
) {
  if (SAFE_METHODS.has(request.method)) return

  // Lucia's auth_session.ts, 0BSD
  const explicitOrigin = request.headers.get("origin")
  if (
    isBearerTransport(request.headers) &&
    explicitOrigin !== null &&
    !isAllowedOrigin(internals.config, request, explicitOrigin)
  )
    throw new AuthApiError("forbiddenOrigin")

  const secFetchSiteHeader = request.headers.get("Sec-Fetch-Site")
  if (secFetchSiteHeader !== "same-origin") {
    const origin = request.headers.get("origin")
    if (
      origin === null
        ? !isBearerTransport(request.headers)
        : !isAllowedOrigin(internals.config, request, origin)
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
