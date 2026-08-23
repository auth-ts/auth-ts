import type { AuthErrorBody } from "@auth-ts/server"
import type { AuthClientConfig } from "../core/auth-client-config"
import { AuthError, AuthNetworkError } from "./auth-error"
import { createCookieJar } from "./cookie-jar"

/** Per-request options. */
export interface FetchJsonOptions {
  method: "GET" | "POST" | "DELETE"
  path: string
  body?: unknown
}

/** The response header a freshly minted access token arrives in. */
export const TOKEN_HEADER = "x-auth-token"

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
  config: AuthClientConfig,
  getLocale: () => string | undefined,
  /** The access token to present, when one is worth presenting. */
  getBearer: () => string | undefined,
  /** Called with any token the server sent back, on every response. */
  onToken: (token: string) => void
): FetchJson {
  const base = `${config.baseURL}${config.basePath}`
  const jar = config.cookieStorage
    ? createCookieJar(config.cookieStorage)
    : undefined

  return async <Result>({ method, path, body }: FetchJsonOptions) => {
    const headers = new Headers()
    const locale = getLocale()
    if (locale) headers.set("accept-language", locale)
    if (body !== undefined) headers.set("content-type", "application/json")
    // Every request carries the token when there is a live one. Endpoints that
    // only need to know who is calling read it and skip the session lookup
    // entirely; `/user` reads it to decide whether to mint a replacement.
    const bearer = getBearer()
    if (bearer) headers.set("authorization", `Bearer ${bearer}`)
    const cookie = await jar?.header()
    if (cookie) headers.set("cookie", cookie)

    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        credentials: jar ? "omit" : "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    } catch (cause) {
      throw new AuthNetworkError(cause)
    }

    await jar?.absorb(response)
    const minted = response.headers.get(TOKEN_HEADER)
    if (minted) onToken(minted)

    if (!response.ok) {
      const parsed = (await response
        .json()
        .catch(() => null)) as AuthErrorBody | null
      const error = parsed?.error

      throw new AuthError(
        error?.code ?? "internalError",
        response.status,
        error?.message ?? `Request failed with status ${response.status}.`,
        error?.retryAfter
      )
    }

    if (response.status === 204) return undefined as Result

    return (await response.json().catch(() => undefined)) as Result
  }
}
