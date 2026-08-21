import { AuthApiError } from "../../http/auth-api-error.ts"
import { defineEndpoint } from "../../http/define-endpoint.ts"

/**
 * The minimal OIDC discovery document.
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
    const { issuer, basePath, baseURL } = internals.options
    if (!issuer || !baseURL) throw new AuthApiError("notFound", 404)

    return {
      data: {
        issuer,
        jwks_uri: `${baseURL}${basePath}/jwks.json`,
        response_types_supported: ["id_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: [internals.options.jwt.alg]
      }
    }
  }
})
