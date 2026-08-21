/**
 * A time span written in the duration grammar shared by every option in this
 * library — a number, an optional space, and a unit: `"10m"`, `"30 days"`, `"60s"`.
 *
 * Units are seconds, minutes, hours, days, weeks, and years (singular, plural,
 * and the common abbreviations). Months are deliberately unsupported because
 * their length is ambiguous; a year is 365.25 days.
 */
export type Duration = string
/**
 * Parses a {@link Duration} into milliseconds.
 *
 * This is the only duration parser in the codebase. Cookie `Max-Age`, session
 * and code expiry, rate-limit windows, `Retry-After`, the deletion freshness
 * window, and the JWT lifetime all resolve through it, so every documented
 * duration behaves identically no matter which option it was written in.
 *
 * @param duration - A time span such as `"10m"` or `"30 days"`.
 * @returns The span in milliseconds.
 * @throws {TypeError} If the value is not a recognised duration.
 */
export declare function parseDuration(duration: Duration): number
/** Parses a {@link Duration} into whole seconds, rounding down. */
export declare function parseDurationSeconds(duration: Duration): number
//# sourceMappingURL=parse-duration.d.ts.map
