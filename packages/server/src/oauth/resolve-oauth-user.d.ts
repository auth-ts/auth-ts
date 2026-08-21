import type { AuthUser } from "../core/auth-db.ts"
import type { AuthServerInternals } from "../core/auth-server-internals.ts"
import type { ProviderIdentity } from "./providers/oauth-provider.ts"
/**
 * Finds or creates the user behind a verified provider identity.
 *
 * The cascade, in order:
 *
 * 1. **An existing connection for this provider account id.** The stable id
 *    match comes first so that someone who changed their email at the provider
 *    still lands in their own account instead of a new one.
 * 2. **A verified email that already belongs to a user.** They are the same
 *    person, so the accounts are joined and the connection recorded.
 * 3. **Neither.** Create the user, then record the connection.
 *
 * A phone number is never consulted: providers do not supply one, and linking by
 * phone is the `connect` flow, which the signed-in user initiates deliberately.
 *
 * @throws {AuthApiError} `unauthenticated` when the provider gave no verified email
 * and there is no existing connection to fall back on.
 */
export declare function resolveOAuthUser(
  internals: AuthServerInternals,
  provider: string,
  identity: ProviderIdentity,
  additionalFields?: Record<string, string | number | boolean>
): Promise<AuthUser>
//# sourceMappingURL=resolve-oauth-user.d.ts.map
