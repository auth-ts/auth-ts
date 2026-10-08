import type { AuthErrorBody } from "../../http/error-response"
import { SESSION_TRANSPORT_HEADER } from "../../shared/session-transport"
import type { AuthClientConfig } from "../core/auth-client-config"
import { AuthError, AuthNetworkError } from "./auth-error"

/** Per-request options. */
export interface FetchJsonOptions {
  method: "GET" | "POST" | "DELETE"
  path: string
  body?: unknown
  bearer?: string
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

/** Explicit credentials cannot fall back to cookies. */
export function createFetchJson(
  config: AuthClientConfig,
  getLocale: () => string | undefined,
  /** The token held right now, sent opportunistically on every request. */
  getHeldToken: () => string | undefined,
  /** Returns a live token, refreshing through `/token` when the held one is spent. */
  ensureToken: () => Promise<string>,
  /** Drops the held token, so the retry cannot present the one just refused. */
  clearToken: () => void,
  getGeneration: () => number
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
      retryAfter: parsed?.retryAfter,
      requestId: parsed?.requestId
    }
  }

  return async <Result>({
    method,
    path,
    body,
    authenticated,
    bearer: providedBearer
  }: FetchJsonOptions) => {
    const generation = getGeneration()
    const send = async (bearer: string | undefined) => {
      if (authenticated && generation !== getGeneration())
        throw new AuthError(
          "unauthenticated",
          401,
          "The account changed during the request."
        )
      const headers = new Headers()
      const locale = getLocale()
      if (locale) headers.set("accept-language", locale)
      if (body !== undefined) headers.set("content-type", "application/json")
      if (bearer) headers.set("authorization", `Bearer ${bearer}`)
      if (config.sessionStorage) headers.set(SESSION_TRANSPORT_HEADER, "bearer")

      try {
        return await fetch(`${base}${path}`, {
          method,
          headers,
          credentials: config.sessionStorage ? "omit" : "include",
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
      } catch (cause) {
        throw new AuthNetworkError(cause)
      }
    }

    let response = await send(
      providedBearer ??
        (path === "/token"
          ? undefined
          : authenticated
            ? await ensureToken()
            : getHeldToken())
    )
    let failure = await readError(response)

    // One retry, and only for a refused credential: the held token may have
    // been signed by a key since rotated, or the device clock may be far enough
    // off that the refresh-ahead window never fired. Narrowed to
    // `unauthenticated` because the other 401s — a wrong deletion code — are
    // verdicts on the request, and resending one would repeat it for nothing.
    if (
      authenticated &&
      providedBearer === undefined &&
      failure?.code === "unauthenticated"
    ) {
      if (generation !== getGeneration())
        throw new AuthError(
          "unauthenticated",
          401,
          "The account changed during the request."
        )
      clearToken()
      // A refusal here throws, so there is no third attempt.
      response = await send(await ensureToken())
      failure = await readError(response)
    }

    if (failure) {
      throw new AuthError(
        failure.code,
        response.status,
        failure.message,
        failure.retryAfter,
        failure.requestId
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
