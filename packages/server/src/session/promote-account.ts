import type { AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { selectOne } from "../lib/select-one"
import { serializeCookie } from "../lib/serialize-cookie"
import type { ParkedAccount } from "./accounts-cookie"
import { parkedTokens, serializeAccounts } from "./accounts-cookie"

/** The account a browser moved to, and the cookies that move it. */
export interface PromotedAccount {
  user: AuthUser
  headers: Headers
}

/**
 * Moves the browser to the next parked account, when there is one.
 *
 * The first parked entry whose user still exists becomes active: its token
 * moves into the refresh cookie and the rest stay parked. Whatever signed the
 * previous account out — sign-out, or revoking the session it was using — ends
 * with the browser on another account rather than on none, which is the whole
 * point of parking them.
 *
 * @returns The account now active and the cookies that make it so, or `null`
 * when nothing can take over — in which case the caller clears the cookies.
 */
export async function promoteNextAccount(
  internals: AuthServerInternals,
  parked: ParkedAccount[],
  secure: boolean
): Promise<PromotedAccount | null> {
  const { config } = internals

  for (const [index, next] of parked.entries()) {
    const user = await selectOne(internals, "users", {
      id: next.session.userId
    })
    if (!user) continue

    const remaining = parkedTokens(parked.filter((_, at) => at !== index))
    const headers = new Headers()
    headers.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.name,
        value: next.token,
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure
      })
    )
    headers.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(remaining),
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure
      })
    )

    return { user, headers }
  }

  return null
}
