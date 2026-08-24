import { AuthApiError } from "../../http/auth-api-error"
import { defineEndpoint } from "../../http/define-endpoint"
import type { EndpointDocs } from "../../openapi/endpoint-docs"

/** How `GET /.well-known/openid-configuration` appears in the OpenAPI document. */
export const getDiscoveryDocs: EndpointDocs<never> = {
  description:
    "For verifiers that take an issuer URL and find the keys themselves.",
  tag: "Discovery",
  auth: "none",
  requires: "baseURL",
  responses: {
    200: { description: "The discovery document.", schema: { type: "object" } }
  }
}

/**
 * Gets the OIDC discovery document.
 *
 * This exists for one reason: Supabase's third-party auth takes an *issuer* URL
 * and discovers the keys itself, so a bare JWKS URL is not enough. This library
 * is not an OAuth authorization server and issues no OAuth flows — it publishes
 * just enough for a verifier to find the keys.
 *
 * OIDC appends the well-known path to the issuer, so the document sits inside the
 * mount and `issuer` matches the `iss` claim on every token exactly.
 *
 * @throws {AuthApiError} `notFound` when no `baseURL` is configured, since
 * without one there is no issuer to advertise.
 */
export const getDiscovery = defineEndpoint({
  method: "GET",
  path: "/.well-known/openid-configuration",
  run: async (internals) => {
    const { issuer, basePath, baseURL, jwks } = internals.config
    if (!issuer || !baseURL) throw new AuthApiError("notFound", 404)

    // Where the key set actually is: a configured URL first; the `/jwks`
    // endpoint when there is a document to serve from it; otherwise the
    // public-folder convention, `<origin>/jwks.json`, which is where
    // `bun x @auth-ts/cli keygen` writes it.
    const jwksUri =
      jwks?.url ??
      (jwks?.json !== undefined
        ? `${baseURL}${basePath}/jwks`
        : `${baseURL}/jwks.json`)

    return {
      data: {
        issuer,
        jwks_uri: jwksUri,
        response_types_supported: ["id_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: [internals.config.jwt.alg]
      }
    }
  }
})
