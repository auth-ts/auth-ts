import { AuthApiError } from "../http/auth-api-error"
import { defineEndpoint } from "../http/define-endpoint"
import type { EndpointDocs } from "../openapi/endpoint-docs"

/** How `GET /jwks` appears in the OpenAPI document. */
export const getJwksDocs: EndpointDocs<never> = {
  description:
    "Only present when `jwks.json` is configured. Normally the key set is a static file in the application's public folder and the verifier is pointed straight at it; this route is for a runtime with no public folder. The one response here a cache may keep.",
  tag: "Discovery",
  auth: "none",
  requires: "jwks",
  responses: {
    200: {
      description: "The public key set, as given.",
      schema: { type: "object" }
    }
  }
}

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

    // Public and stable, so it is the one response here a cache may keep.
    return {
      data: json,
      headers: new Headers({ "cache-control": "public, max-age=3600" })
    }
  }
})
