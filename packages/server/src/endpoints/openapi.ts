import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { buildOpenAPIDocument } from "../openapi/build-document"

/**
 * Get the OpenAPI document.
 *
 * Off unless `openapi` is set. The document is not secret, but it does name the
 * providers this deployment configured and the additional fields it declares,
 * which is a thing to publish on purpose rather than by default.
 *
 * @throws {AuthApiError} `notFound` when `openapi` is not enabled.
 */
export const getOpenAPIDocument = defineEndpoint({
  method: "GET",
  path: "/openapi.json",
  run: async (internals) => {
    if (!internals.config.openapi) throw new AuthApiError("notFound", 404)

    return { data: buildOpenAPIDocument(internals.config) }
  }
})
