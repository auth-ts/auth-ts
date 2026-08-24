import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"

// Pinned rather than floating: the page is served by this library, so a bad
// upstream release would be our outage, not theirs.
const SCALAR = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.36.2"

/**
 * Get the browsable API reference.
 *
 * A CDN script tag rather than a bundled viewer, which is what keeps this
 * dependency-free. Gated on `openapi` alongside the document it reads.
 *
 * @throws {AuthApiError} `notFound` when `openapi` is not enabled.
 */
export const getReference = defineEndpoint({
  method: "GET",
  path: "/reference",
  run: async (internals) => {
    if (!internals.config.openapi) throw new AuthApiError("notFound", 404)

    const specURL = `${internals.config.basePath}/openapi.json`

    return {
      data: undefined,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      // The scripts sit inside an explicit body. Left to float, they parse into
      // the head and run while `document.body` is still null, which the viewer
      // mounts into — a blank page and three null dereferences in the console.
      body: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>API reference</title>
</head>
<body>
<script id="api-reference" data-url="${specURL}"></script>
<script src="${SCALAR}"></script>
</body>
</html>`
    }
  }
})
