/**
 * A time span written in the duration grammar shared by every option in this
 * library — a number, an optional space, and a unit: `"10m"`, `"30 days"`, `"60s"`.
 *
 * Units are seconds, minutes, hours, days, weeks, and years (singular, plural,
 * and the common abbreviations). Months are deliberately unsupported because
 * their length is ambiguous; a year is 365.25 days.
 */
export type Duration = string

const MILLISECONDS_PER_UNIT: Record<string, number> = {
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  s: 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  min: 60 * 1000,
  mins: 60 * 1000,
  m: 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  hr: 60 * 60 * 1000,
  hrs: 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  year: 365.25 * 24 * 60 * 60 * 1000,
  years: 365.25 * 24 * 60 * 60 * 1000,
  yr: 365.25 * 24 * 60 * 60 * 1000,
  yrs: 365.25 * 24 * 60 * 60 * 1000,
  y: 365.25 * 24 * 60 * 60 * 1000
}

const DURATION_PATTERN = /^(\+|-)?\s*(\d+(?:\.\d+)?)\s*([a-z]+)$/i

/**
 * The furthest a `Date` can reach from the epoch, in milliseconds.
 *
 * Every duration here ends up added to `Date.now()`, so anything past this is
 * not a long time but an `Invalid Date` — and a session or token whose expiry is
 * `NaN` compares as neither expired nor live.
 */
const MAX_DURATION_MS = 8.64e15

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
 * @throws {TypeError} If the value is not a recognised duration, or is too large
 * for a `Date` to represent.
 */
export function parseDuration(duration: Duration) {
  const matched = DURATION_PATTERN.exec(duration.trim())
  if (!matched) {
    throw new TypeError(
      `Invalid duration: ${JSON.stringify(duration)}. Expected a value like "10m" or "30 days".`
    )
  }

  const [, sign = "", amount = "0", unit = ""] = matched
  const normalized = unit.toLowerCase()
  const millisecondsPerUnit = Object.hasOwn(MILLISECONDS_PER_UNIT, normalized)
    ? MILLISECONDS_PER_UNIT[normalized]
    : undefined
  if (typeof millisecondsPerUnit !== "number") {
    throw new TypeError(
      `Unknown duration unit: ${JSON.stringify(unit)}. Months are not supported.`
    )
  }

  const milliseconds = Number(amount) * millisecondsPerUnit
  // `>` rather than `isFinite`: an amount long enough to overflow to Infinity
  // is only the extreme case of one too large for a Date to represent.
  if (!(milliseconds <= MAX_DURATION_MS)) {
    throw new TypeError(
      `Duration out of range: ${JSON.stringify(duration)}. The largest supported span is about 273,000 years.`
    )
  }
  return sign === "-" ? -milliseconds : milliseconds
}

/** Parses a {@link Duration} into whole seconds, rounding down. */
export function parseDurationSeconds(duration: Duration) {
  return Math.floor(parseDuration(duration) / 1000)
}
