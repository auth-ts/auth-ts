/**
 * Thrown when the server is set up wrong, rather than when a request is wrong.
 *
 * Almost always at construction — a missing `JWT_PRIVATE_KEY`, no sign-in method
 * configured, a reserved key declared as an additional field. Failing there means
 * a misconfigured deployment dies on boot with the offending option named,
 * instead of on the first user's sign-in attempt at 3am.
 *
 * The one runtime case is `getSession`/`getToken` finding no cookie while
 * `cookie.path` is still scoped to the auth mount: returning null there would
 * present as "SSR is always logged out", which is a bug report rather than a
 * clue.
 */
export declare class AuthConfigError extends Error {
  constructor(message: string)
}
//# sourceMappingURL=auth-config-error.d.ts.map
