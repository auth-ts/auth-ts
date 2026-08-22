import type { AuthServerInternals } from "../core/auth-server-internals"

/**
 * How often a server runs {@link AuthDB.cleanup}, at most.
 *
 * Not an option. A minute is short enough that nothing accumulates for long —
 * under a flood, `attempts` grows for at most one window plus one interval —
 * and long enough that the cost is one extra round trip per minute per
 * instance rather than one per request. A deployment that wants sweeping on its
 * own schedule leaves `cleanup` off the contract entirely and runs a cron.
 */
export const CLEANUP_INTERVAL_MS = 60_000

/**
 * Runs the store's sweep, at most once an interval, after a request that could
 * have written something.
 *
 * Awaited, unlike the fire-and-forget it replaces. An unawaited promise is not
 * guaranteed to run on Cloudflare Workers once the response has been returned —
 * that needs `ctx.waitUntil`, which a framework-agnostic library never sees —
 * so a sweep nobody waits for is a sweep that may silently never happen on the
 * platform this is most likely deployed to.
 *
 * Skipped on `GET` because reads cannot create anything to clean up, and a
 * read-heavy deployment should not pay for the sweep on every token refresh.
 * The interval is claimed before the sweep runs, so a slow one is not entered
 * twice by concurrent requests.
 *
 * Failures go to the log rather than into an empty catch, and never reach the
 * response: this is hygiene, and expiry is enforced on read regardless.
 */
export async function sweepExpired(
  internals: AuthServerInternals,
  method: string
) {
  const { db } = internals
  if (!db.cleanup || method === "GET") return

  const now = Date.now()
  if (now - internals.sweep.lastRanAt < CLEANUP_INTERVAL_MS) return
  internals.sweep.lastRanAt = now

  try {
    await db.cleanup()
  } catch (error) {
    internals.log.error("cleanup failed", { error: String(error) })
  }
}
