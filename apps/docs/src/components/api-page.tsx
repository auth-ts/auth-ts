import { createOpenAPIPage } from "fumadocs-openapi/ui"

// Read here rather than imported from `lib/openapi`: that module pulls in
// `fumadocs-openapi/server`, which touches the filesystem, and this component
// ships to the browser.
const apiURL = import.meta.env.VITE_PLAYGROUND_API_URL as string | undefined

/** Renders one operation, with its schemas and request samples. */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: Boolean(apiURL) }
})
