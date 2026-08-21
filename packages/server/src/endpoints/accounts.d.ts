import type { AuthUser } from "../core/auth-db.ts"
/** One signed-in user in this browser. */
export interface AccountInfo {
  user: AuthUser
  /** Whether this is the account the browser is currently acting as. */
  current: boolean
}
/** Input for listing accounts. */
export interface ListAccountsInput {
  headers?: Headers
  requestURL?: string
}
/**
 * Lists every user signed in to this browser.
 *
 * The account switcher. Parked tokens whose sessions have died are pruned from
 * the cookie in the same response, so a revoked device stops appearing here
 * immediately rather than lingering until someone clicks it.
 *
 * Note the terminology, which is easy to blur: `/sessions` is one user's devices,
 * `/accounts` is one browser's users, and `/connections` is one user's linked
 * providers.
 */
export declare const listAccounts: import("../http/define-endpoint.ts").EndpointDefinition<
  ListAccountsInput,
  {
    accounts: AccountInfo[]
  }
>
//# sourceMappingURL=accounts.d.ts.map
