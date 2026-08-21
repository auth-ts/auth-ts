import { defineEndpoint } from "../http/define-endpoint.ts"
import { buildJwks } from "../jwt/build-jwks.ts"

/**
 * Serves the public keys.
 *
 * This is the URL Neon and any other JWKS-trusting verifier is pointed at. It
 * lives inside the mount so one path prefix owns everything, and so the discovery
 * document can point at a sibling rather than fighting over the root of the
 * domain.
 */
export const getJwks = defineEndpoint({
  method: "GET",
  path: "/jwks.json",
  run: async (internals) => {
    const { publicJwk, additionalPublicJwks } = await internals.keys()

    return { data: buildJwks(publicJwk, additionalPublicJwks) }
  }
})
