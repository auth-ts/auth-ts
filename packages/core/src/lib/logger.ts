/** Log levels in increasing verbosity. `"silent"` disables logging entirely. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug"

/**
 * A log sink.
 *
 * It never receives request headers: the `Cookie` header *is* the refresh token,
 * so handing the carrier to a logger would put a live credential one destructure
 * away from every log aggregator. Correlation data (path, request id) is passed
 * explicitly in `data` instead.
 */
export type Logger = (
  level: Exclude<LogLevel, "silent">,
  message: string,
  data?: Record<string, unknown>
) => void

/** The logging surface handed to internals — one method per level, already filtered. */
export interface LeveledLogger {
  error(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  debug(message: string, data?: Record<string, unknown>): void
}

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
}

const consoleSink: Logger = (level, message, data) => {
  const line = `[auth-ts] ${message}`
  if (level === "error") console.error(line, data ?? "")
  else if (level === "warn") console.warn(line, data ?? "")
  else if (level === "info") console.info(line, data ?? "")
  else console.debug(line, data ?? "")
}

/**
 * Builds the level-filtered logger used throughout the library.
 *
 * Redaction is structural rather than a scrubbing step: tokens, code hashes, and
 * cookie values are never passed to these methods in the first place, so there is
 * no filter to forget to apply. `error`, `warn`, and `info` also carry no
 * identifiers, since emails and phone numbers are personal data once they reach a
 * log aggregator; `debug` may include them and is documented as not for production.
 *
 * @param logLevel - Highest level to emit. Defaults to `"warn"`.
 * @param logger - Sink override, e.g. pino. Defaults to `console`.
 */
export function createLogger(
  logLevel: LogLevel = "warn",
  logger: Logger = consoleSink
) {
  const threshold = LEVEL_RANK[logLevel]

  const emit =
    (level: Exclude<LogLevel, "silent">) =>
    (message: string, data?: Record<string, unknown>) => {
      if (LEVEL_RANK[level] > threshold) return
      logger(level, message, data)
    }

  return {
    error: emit("error"),
    warn: emit("warn"),
    info: emit("info"),
    debug: emit("debug")
  }
}
