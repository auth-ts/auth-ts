import { createOpenAPIPage } from "fumadocs-openapi/ui"
import { apiURL } from "~/lib/openapi"

/** Renders one operation, with its schemas and request samples. */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: Boolean(apiURL) }
})
