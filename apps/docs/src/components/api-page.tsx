import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators"
import { curl } from "fumadocs-openapi/requests/generators/curl"
import { javascript } from "fumadocs-openapi/requests/generators/javascript"
import { createOpenAPIPage } from "fumadocs-openapi/ui"

const codeUsages = createCodeUsageGeneratorRegistry()
codeUsages.add("curl", curl)
codeUsages.add("js", javascript)

// Read here rather than imported from `lib/openapi`: that module pulls in
// `fumadocs-openapi/server`, which touches the filesystem, and this component
// ships to the browser.
const apiURL = import.meta.env.VITE_PLAYGROUND_API_URL as string | undefined

/** Renders one operation, with its schemas and request samples. */
export const OpenAPIPage = createOpenAPIPage({
  codeUsages,
  playground: {
    enabled: Boolean(apiURL),
    fetchOptions: {
      // Cross-origin requests MUST include browser session cookies.
      onRequestInit: (init) => ({ ...init, credentials: "include" })
    }
  }
})
