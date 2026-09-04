import type { AuthConfig } from "../core/auth-config"
import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import { buildOpenAPIDocument } from "../openapi/build-document"

const documents = new WeakMap<
  AuthConfig,
  ReturnType<typeof buildOpenAPIDocument>
>()

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

    // Pure function of the resolved config, so built once per server.
    let document = documents.get(internals.config)
    if (!document) {
      document = buildOpenAPIDocument(internals.config)
      documents.set(internals.config, document)
    }

    return { data: document }
  }
})
