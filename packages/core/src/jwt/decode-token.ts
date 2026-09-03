import { decodeJwt } from "jose"
import type { UnverifiedClaims } from "./verify-token"

/** The result of an unverified decode. */
export interface DecodedToken {
  /** Exactly what the token says, with nothing guaranteed — `exp` may be absent. */
  claims: UnverifiedClaims
  /**
   * Whether `exp` has passed. Says nothing about whether the token is genuine,
   * and is `false` for a token that has no `exp` at all — such a token is not
   * expired; it is one that verification would refuse.
   */
  expired: boolean
}

/**
 * Decodes a token **without verifying its signature**.
 *
 * The only synchronous function here, and unverified for a structural reason:
 * signature verification is asynchronous under Web Crypto, and the alternative
 * would be importing `node:crypto` and maintaining a second code path that does
 * not run on edge runtimes.
 *
 * Use it for triage — logging, routing by `sub`, deciding whether to refresh.
 * **Never** for authorization: anyone can hand-craft a token that satisfies every
 * check performed here. It is called `decodeToken` rather than `isTokenValid`
 * precisely so the call site reads as what it is.
 *
 * @returns The claims and whether they have expired, or `null` if the input is
 * not a well-formed JWT.
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    const claims = decodeJwt(token) as UnverifiedClaims
    const expired =
      typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()

    return { claims, expired }
  } catch {
    return null
  }
}
