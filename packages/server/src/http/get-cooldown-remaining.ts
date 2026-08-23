import type { AuthOTP } from "../core/auth-db"
import type { Duration } from "../lib/parse-duration"
import { parseDuration } from "../lib/parse-duration"

/**
 * Seconds left before another code may be sent to this identifier.
 *
 * Derived from the newest code's `expiresAt` minus the code lifetime, which
 * recovers when it was sent without storing a second timestamp — no new column,
 * nothing extra to keep consistent.
 *
 * The windows cap total volume; this caps rapid-fire. Note the accepted tradeoff,
 * which every implementation of this shares: a stranger who sends a code to your
 * address starts your cooldown. Sixty seconds of nuisance, itself bounded by
 * their own per-IP window.
 *
 * @returns Remaining seconds, or 0 when a send is allowed now.
 */
export function getCooldownRemaining(
  otp: AuthOTP | null,
  codeTtl: Duration,
  cooldown: Duration
): number {
  if (!otp) return 0

  const sentAt = otp.expiresAt.getTime() - parseDuration(codeTtl)
  const nextAllowedAt = sentAt + parseDuration(cooldown)
  const remaining = nextAllowedAt - Date.now()

  return remaining <= 0 ? 0 : Math.ceil(remaining / 1000)
}
