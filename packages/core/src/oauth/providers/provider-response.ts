import { AuthApiError } from "../../http/auth-api-error"

/**
 * How long a provider gets to answer, for every call core makes to one.
 *
 * Generous next to the sub-second responses GitHub and Google normally give, but
 * bounded: without it a stalled provider holds the request open for as long as
 * the platform allows, and a burst of those is an outage.
 */
export const PROVIDER_DEADLINE_MS = 10_000

/**
 * Whether a provider response means "try again later" rather than "no".
 *
 * A 5xx is the provider being down; a 429 is the provider throttling us. In
 * neither case has anything been decided about the person signing in, so both
 * are reported as the provider being unavailable. Anything else — a rejected
 * code, a revoked token, a missing scope — is a verdict, and is reported as one.
 *
 * GitHub is the exception that needs reading past the status: it answers its
 * rate limits with 403, not 429 — `x-ratelimit-remaining: 0` for the primary
 * limit and `retry-after` for the secondary one. A 403 carrying either signal
 * is throttling; a 403 without them is the ordinary refusal it looks like.
 */
export function isProviderUnavailable(response: Response) {
  if (response.status >= 500 || response.status === 429) return true

  return (
    response.status === 403 &&
    (response.headers.get("x-ratelimit-remaining") === "0" ||
      response.headers.has("retry-after"))
  )
}

/**
 * Turns a non-2xx provider response into the failure it actually represents.
 *
 * The person signing in should be told to try again when the provider is down
 * or throttling, and told they were refused only when they actually were.
 */
export function providerRejected(response: Response) {
  return isProviderUnavailable(response)
    ? new AuthApiError("providerUnavailable", 502)
    : new AuthApiError("providerRejected", 401)
}
