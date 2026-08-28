import type { AuthErrorBody } from "@auth-ts/server"
import type { AuthClientConfig } from "../core/auth-client-config"
import { AuthError, AuthNetworkError } from "./auth-error"
import type { CookieJar } from "./cookie-jar"

/** Per-request options. */
export interface FetchJsonOptions {
  method: "GET" | "POST" | "DELETE"
  path: string
  body?: unknown
  /**
   * Get a live token before sending, and retry once if the server refuses it.
   *
   * Every endpoint but `/token` and the sign-in routes needs this: the server
   * authenticates from the bearer alone, so a request sent with a spent token
   * is a 401 rather than something the server quietly repairs.
   */
  authenticated?: boolean
}

/** Issues authenticated requests to the auth server and unwraps its responses. */
export type FetchJson = <Result>(options: FetchJsonOptions) => Promise<Result>

/**
 * Builds the request function every client method uses.
 *
 * `credentials: "include"` is what makes the refresh cookie travel, and is the
 * reason a cross-origin server must answer with an explicit origin rather than a
 * wildcard. With `cookieStorage` configured the client is the cookie jar
 * instead: it sends what it holds as the `Cookie` header and keeps what comes
 * back in `Set-Cookie`, with credentials omitted so the two cannot disagree.
 *
 * A failed request and a refused one are turned into different errors on
 * purpose: the caller must be able to tell "your session is gone" from "the
 * train went into a tunnel", because only one of those should clear local state.
 */
export function createFetchJson(
  jar: CookieJar | undefined,
  config: AuthClientConfig,
  getLocale: () => string | undefined,
  /** The token held right now, sent opportunistically on every request. */
  getHeldToken: () => string | undefined,
  /** Returns a live token, refreshing through `/token` when the held one is spent. */
  ensureToken: () => Promise<string>,
  /** Drops the held token, so the retry cannot present the one just refused. */
  clearToken: () => void
): FetchJson {
  const base = `${config.baseURL}${config.basePath}`

  /** The failure a response describes, or `null` when it succeeded. */
  const readError = async (response: Response) => {
    if (response.ok) return null

    const parsed = (await response
      .json()
      .catch(() => null)) as AuthErrorBody | null

    return {
      code: parsed?.code ?? "internalError",
      message:
        parsed?.message ?? `Request failed with status ${response.status}.`,
      retryAfter: parsed?.retryAfter
    }
  }

  return async <Result>({
    method,
    path,
    body,
    authenticated
  }: FetchJsonOptions) => {
    const send = async (bearer: string | undefined) => {
      const headers = new Headers()
      const locale = getLocale()
      if (locale) headers.set("accept-language", locale)
      if (body !== undefined) headers.set("content-type", "application/json")
      if (bearer) headers.set("authorization", `Bearer ${bearer}`)
      // Read per attempt, not once: a retry follows a refresh that may have
      // taken a `Set-Cookie` with it.
      const cookie = await jar?.header()
      if (cookie) headers.set("cookie", cookie)

      try {
        return await fetch(`${base}${path}`, {
          method,
          headers,
          credentials: jar ? "omit" : "include",
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
      } catch (cause) {
        throw new AuthNetworkError(cause)
      }
    }

    let response = await send(
      authenticated ? await ensureToken() : getHeldToken()
    )
    await jar?.absorb(response)
    let failure = await readError(response)

    // One retry, and only for a refused credential: the held token may have
    // been signed by a key since rotated, or the device clock may be far enough
    // off that the refresh-ahead window never fired. Narrowed to
    // `unauthenticated` because the other 401s — a wrong deletion code — are
    // verdicts on the request, and resending one would repeat it for nothing.
    if (authenticated && failure?.code === "unauthenticated") {
      clearToken()
      // A refusal here throws, so there is no third attempt.
      response = await send(await ensureToken())
      await jar?.absorb(response)
      failure = await readError(response)
    }

    if (failure) {
      throw new AuthError(
        failure.code,
        response.status,
        failure.message,
        failure.retryAfter
      )
    }

    if (response.status === 204) return undefined as Result

    const text = await response.text()
    if (!text) return undefined as Result

    try {
      return JSON.parse(text) as Result
    } catch {
      throw new AuthError(
        "internalError",
        response.status,
        "The server answered with a malformed body."
      )
    }
  }
}
