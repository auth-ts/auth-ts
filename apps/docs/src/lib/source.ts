import { loader } from "fumadocs-core/source"
import { docs } from "../../.source/server.ts"

/** The documentation tree, loaded from `content/docs`. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource()
})
