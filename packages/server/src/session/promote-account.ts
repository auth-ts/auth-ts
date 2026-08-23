import type { AuthSession, AuthUser } from "../core/auth-db"
import type { AuthServerInternals } from "../core/auth-server-internals"
import { selectOne } from "../lib/select-one"
import {
  serializeCookie,
  shouldUseSecureCookies
} from "../lib/serialize-cookie"
import type { ParkedAccount } from "./accounts-cookie"
import { parkedTokens, serializeAccounts } from "./accounts-cookie"
import type { SessionCookieContext } from "./session-cookies"
import { refreshCookies } from "./session-cookies"

/** The account a browser moved to, and the cookies that move it. */
export interface PromotedAccount {
  user: AuthUser
  session: AuthSession
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
  context: SessionCookieContext
): Promise<PromotedAccount | null> {
  const { config } = internals

  for (const [index, next] of parked.entries()) {
    const user = await selectOne(internals, "users", {
      id: next.session.userId
    })
    if (!user) continue

    const remaining = parkedTokens(parked.filter((_, at) => at !== index))
    const headers = new Headers()
    for (const cookie of refreshCookies(internals, {
      ...context,
      rawToken: next.token
    })) {
      headers.append("set-cookie", cookie)
    }
    headers.append(
      "set-cookie",
      serializeCookie({
        name: config.cookie.accountsName,
        value: serializeAccounts(remaining),
        path: config.cookie.path,
        maxAge: config.session.ttl,
        secure: shouldUseSecureCookies(context.requestURL)
      })
    )

    return { user, session: next.session, headers }
  }

  return null
}
