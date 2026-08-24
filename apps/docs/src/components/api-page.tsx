import { createOpenAPIPage } from "fumadocs-openapi/ui"

/**
 * Renders one operation, with its schemas and request samples.
 *
 * No playground. This site documents the library rather than any server, so
 * there is nothing to send a request to: a reader's own server would have to
 * allow this origin, and the endpoints that authenticate from the refresh
 * cookie could not work cross-origin regardless. Routing around that through a
 * third-party proxy would mean their access tokens leaving for someone else's
 * host. The playground that works is the one `openapi: true` serves from their
 * own mount.
 */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false }
})
