/**
 * Serves the public keys.
 *
 * This is the URL Neon and any other JWKS-trusting verifier is pointed at. It
 * lives inside the mount so one path prefix owns everything, and so the discovery
 * document can point at a sibling rather than fighting over the root of the
 * domain.
 */
export declare const getJwks: import("../http/define-endpoint.ts").EndpointDefinition<unknown, import("../jwt/build-jwks.ts").Jwks>;
//# sourceMappingURL=jwks.json.d.ts.map