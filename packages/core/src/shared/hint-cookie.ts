/** The cookie that tells a browser client whether asking for a token is worth a request. */
export const HINT_COOKIE_NAME = "auth-ts.hint"

/**
 * What the hint says: the active user's id, or `"out"` for demonstrably nobody.
 *
 * Carrying the id rather than `"in"` is what lets a browser know *which*
 * refresh cookie to spend without reading every one of them, and lets a
 * server-rendered page know who to render as before it resolves anything.
 *
 * `"out"` is only written where the hint may be delivered cross-origin, since
 * that is the only deployment where a missing hint is ambiguous.
 */
export type HintValue = string
