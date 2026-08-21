/** Log levels in increasing verbosity. `"silent"` disables logging entirely. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
/**
 * A log sink.
 *
 * It never receives request headers: the `Cookie` header *is* the refresh token,
 * so handing the carrier to a logger would put a live credential one destructure
 * away from every log aggregator. Correlation data (path, request id) is passed
 * explicitly in `data` instead.
 */
export type Logger = (level: Exclude<LogLevel, "silent">, message: string, data?: Record<string, unknown>) => void;
/** The logging surface handed to internals — one method per level, already filtered. */
export interface LeveledLogger {
    error(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    debug(message: string, data?: Record<string, unknown>): void;
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
export declare function createLogger(logLevel?: LogLevel, logger?: Logger): {
    error: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    info: (message: string, data?: Record<string, unknown>) => void;
    debug: (message: string, data?: Record<string, unknown>) => void;
};
//# sourceMappingURL=logger.d.ts.map