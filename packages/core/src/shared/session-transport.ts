/** Selects credential delivery, never authentication authority. */
export const SESSION_TRANSPORT_HEADER = "X-Auth-Transport"

/** Explicit bearer transport excludes ambient cookies. */
export function isBearerTransport(headers?: Headers) {
  return headers?.get(SESSION_TRANSPORT_HEADER) === "bearer"
}
