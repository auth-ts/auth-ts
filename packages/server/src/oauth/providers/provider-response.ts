import { AuthApiError } from "../../http/auth-api-error.ts"

/**
 * Turns a non-2xx provider response into the failure it actually represents.
 *
 * A 5xx is the provider being down, and the person signing in should be told
 * to try again, not that their sign-in was refused. Anything else — a rejected
 * code, a revoked token, a missing scope — is a refusal, and is reported as one.
 */
export function providerRejected(response: Response) {
  return response.status >= 500
    ? new AuthApiError("providerUnavailable", 502)
    : new AuthApiError("unauthenticated", 401)
}
