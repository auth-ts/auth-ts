import { AuthApiError } from "./auth-api-error"

/**
 * The request's JSON body, refused unless every key is one this endpoint takes.
 *
 * An unknown key is a 400, never a value quietly ignored: the body is the one
 * part of a request a caller writes freely, and an endpoint that spreads it
 * into its input hands the wire every field that input declares — `token`
 * included, which `CallerInput` carries for callers with no request at all.
 *
 * @param accepted - Every key this endpoint reads from the body.
 * @throws {AuthApiError} `invalidField` for any other key.
 */
export async function readBody<T>(
  request: Request,
  accepted: readonly string[]
): Promise<T> {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >

  for (const key of Object.keys(body)) {
    if (!accepted.includes(key)) {
      throw new AuthApiError("invalidField", 400, {
        message: `${key} is not accepted here.`
      })
    }
  }

  return body as T
}
