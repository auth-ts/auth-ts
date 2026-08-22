import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"

/**
 * Serves the configured public key set.
 *
 * Normally there is nothing to serve: the JWKS is a static file in the
 * application's public folder, written by `bun x @auth-ts/cli keygen`, and the
 * verifier is pointed straight at it. This endpoint is for a runtime with no
 * public folder — pass the parsed document as `jwks.json` and it is served
 * from inside the mount, as given.
 *
 * @throws {AuthApiError} `notFound` when no `jwks.json` is configured, so the
 * route is indistinguishable from one that does not exist.
 */
export const getJwks = defineEndpoint({
  method: "GET",
  path: "/jwks",
  run: async (internals) => {
    const json = internals.config.jwks?.json
    if (json === undefined) throw new AuthApiError("notFound", 404)

    return { data: json }
  }
})
