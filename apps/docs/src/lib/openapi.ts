import { buildOpenAPIDocument } from "@auth-ts/core"
import type { OpenAPIOptions } from "fumadocs-openapi/server"
import { createOpenAPI } from "fumadocs-openapi/server"

/**
 * The document, exactly as the package builds it.
 *
 * What `/openapi.json` serves. It describes the library rather than any
 * deployment, so its server stays relative no matter what the playground is
 * pointed at.
 */
export function apiDocument() {
  return buildOpenAPIDocument()
}

/**
 * The same document, with the server the playground should send to.
 *
 * Upstream takes the playground's target from `servers`, and exposes no way to
 * set one without the other — so this copy exists only to carry it, and never
 * reaches `/openapi.json`. Nothing else reads it: the route heading and the
 * request samples are generated from the path, not from this.
 */
function renderedDocument() {
  const playgroundURL = import.meta.env.VITE_PLAYGROUND_API_URL as
    | string
    | undefined
  const built = buildOpenAPIDocument()

  return playgroundURL ? { ...built, servers: [{ url: playgroundURL }] } : built
}

// The seam between our document type and the far stricter one upstream models.
// The shapes agree; the types do not track each other, and upstream does not
// export the one it wants.
const input = {
  "auth-ts": renderedDocument
} as unknown as OpenAPIOptions["input"]

/**
 * The API reference, built from the package source at build time.
 *
 * A thunk rather than a committed `openapi.json`: there is no artifact to
 * regenerate, so the reference cannot describe a server that no longer exists.
 */
export const openapi = createOpenAPI({ input })

/** The document's tags, in the order it declares them. */
export const tagOrder = apiDocument().tags.map((tag) => tag.name)

/** A tag as a folder segment, e.g. `"Sign in"` -> `"sign-in"`. */
export function tagSlug(tag: string) {
  return tag.toLowerCase().replace(/\s+/g, "-")
}

/** A route's segments as URL levels, e.g. `"/sessions/{id}"` -> `["sessions", "id"]`. */
export function routeSegments(path: string) {
  // A literal brace 404s once encoded.
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[{}]/g, "").replace(/^\.+/, ""))
}
