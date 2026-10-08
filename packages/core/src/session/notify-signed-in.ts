import type { AuthSession, AuthUser } from "../core/auth-database"
import type { AuthInternals } from "../core/auth-internals"
import { resolveLocale } from "../http/resolve-locale"
import { defer } from "../lib/defer"

/**
 * Tells the account somebody signed in, when the configuration asks for it.
 *
 * Nothing is sent for an account without an email address. Runs behind the
 * response where `waitUntil` is configured; a failure is logged, never
 * thrown, because the session already exists and failing the sign-in would
 * only make the user mint another.
 */
export function notifySignedIn(
  internals: AuthInternals,
  {
    user,
    session,
    headers
  }: { user: AuthUser; session: AuthSession; headers: Headers }
) {
  const send = internals.config.email?.sendSignedInNotification
  if (!send || !user.email) return

  return defer(
    internals,
    "signed-in notification",
    Promise.resolve().then(() =>
      send({
        email: user.email as string,
        user,
        session,
        locale: resolveLocale(
          headers.get("accept-language"),
          internals.config.localization
        ),
        headers
      })
    )
  )
}
