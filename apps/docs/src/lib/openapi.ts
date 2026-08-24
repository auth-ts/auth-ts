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

/**
 * Where each operation belongs in the sidebar, and under which heading.
 *
 * The generated tree sorts by file name, which is the operation id — so routes
 * that belong together end up scattered. Ordering by tag, then by route, puts
 * every sign-in path in one run and every session path in the next.
 */
export const operationOrder = (() => {
  const document = buildOpenAPIDocument()
  const tags = document.tags.map((tag) => tag.name)

  const operations = Object.entries(document.paths)
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
