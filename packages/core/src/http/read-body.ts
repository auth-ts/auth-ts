import { AuthApiError } from "./auth-api-error"

/** The author's server refuses a body past this before parsing; so does this. */
const MAX_BODY_BYTES = 16 * 1024

/**
 * The request's JSON body, refused unless every key is one this endpoint takes.
 *
 * An unknown key is a 400, never a value quietly ignored: the body is the one
 * part of a request a caller writes freely, and an endpoint that spreads it
 * into its input hands the wire every field that input declares — `token`
 * included, which `CallerInput` carries for callers with no request at all.
 *
 * A body over 16 KiB is refused, by `Content-Length` when there is one and
 * otherwise the moment the stream passes the cap, so a chunked body is never
 * buffered whole. Header sizes and read timeouts are the runtime's.
 *
 * @param accepted - Every key this endpoint reads from the body.
 * @throws {AuthApiError} `payloadTooLarge` past the cap, `invalidField` for any other key.
 */
export async function readBody<T>(
  request: Request,
  accepted: readonly string[]
): Promise<T> {
  const parsed = parse(await readCapped(request))
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AuthApiError("invalidField", {
      message: "The body must be a JSON object."
    })
  }
  const body = parsed as Record<string, unknown>

  for (const key of Object.keys(body)) {
    if (!accepted.includes(key)) {
      throw new AuthApiError("invalidField", {
        message: `${key} is not accepted here.`
      })
    }
  }

  return body as T
}

async function readCapped(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new AuthApiError("payloadTooLarge")
  }
  const reader = request.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new AuthApiError("payloadTooLarge")
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(concat(chunks, received))
}

function concat(chunks: Uint8Array[], length: number) {
  const joined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
