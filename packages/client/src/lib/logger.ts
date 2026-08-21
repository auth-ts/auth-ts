/** Log levels in increasing verbosity. `"silent"` disables logging entirely. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug"

/** A log sink. Tokens never reach it — see {@link createLogger}. */
export type Logger = (
  level: Exclude<LogLevel, "silent">,
  message: string,
  data?: Record<string, unknown>
) => void

/** The logging surface used inside the client — one method per level, pre-filtered. */
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
 * Builds the level-filtered logger.
 *
 * Defaults to `"error"` rather than `"warn"`: this runs in other people's
 * browsers, where a chatty library is noise in someone else's console. Debug
 * traces the token and user lifecycle, which is the answer to "why was I
 * suddenly signed out".
 *
 * Redaction is structural, as on the server: the token is never passed to these
 * methods, so there is no filter to forget.
 */
export function createLogger(
  logLevel: LogLevel = "error",
  logger: Logger = consoleSink
): LeveledLogger {
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
