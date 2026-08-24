import { buildOpenAPIDocument } from "@auth-ts/server"
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
 * The path every route is mounted under, from the canonical document.
 *
 * Read from {@link apiDocument} and never from the rendered copy: that one's
 * server is whatever the playground was pointed at, which is not a prefix of
 * anything.
 */
export const mountPath = apiDocument().servers[0]?.url ?? ""

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

/**
 * Where each operation belongs in the sidebar, and under which heading.
 *
 * The generated tree sorts by file name, which is the operation id — so routes
 * that belong together end up scattered. Ordering by tag, then by route, puts
 * every sign-in path in one run and every session path in the next.
 */
export const operationOrder = (() => {
  const built = buildOpenAPIDocument()
  const tags = built.tags.map((tag) => tag.name)

  const operations = Object.entries(built.paths)
    .flatMap(([path, item]) =>
      Object.entries(item).map(([method, operation]) => ({
        path,
        method,
        ...(operation as { operationId: string; tags: string[] })
      }))
    )
    .sort(
      (left, right) =>
        tags.indexOf(left.tags[0] ?? "") - tags.indexOf(right.tags[0] ?? "") ||
        left.path.localeCompare(right.path) ||
        left.method.localeCompare(right.method)
    )

  return operations.map((operation, rank) => ({
    id: operation.operationId,
    tag: operation.tags[0] ?? "",
    rank
  }))
})()
