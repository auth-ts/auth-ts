import { buildOpenAPIDocument } from "@auth-ts/server"
import type { OpenAPIOptions } from "fumadocs-openapi/server"
import { createOpenAPI } from "fumadocs-openapi/server"

// The seam between our document type and the far stricter one upstream models.
// The shapes agree; the types do not track each other, and upstream does not
// export the one it wants.
const input = {
  "auth-ts": () => buildOpenAPIDocument()
} as unknown as OpenAPIOptions["input"]

/**
 * The API reference, built from the package source at build time.
 *
 * A thunk rather than a committed `openapi.json`: there is no artifact to
 * regenerate, so the reference cannot describe a server that no longer exists.
 * Built without a config, which is what makes it the library's document rather
 * than one deployment's — every feature on, every provider offered.
 */
export const openapi = createOpenAPI({ input })
