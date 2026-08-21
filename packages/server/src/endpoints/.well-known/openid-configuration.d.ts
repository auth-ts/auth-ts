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
export declare const getDiscovery: import("../../http/define-endpoint.ts").EndpointDefinition<unknown, {
    issuer: string;
    jwks_uri: string;
    response_types_supported: string[];
    subject_types_supported: string[];
    id_token_signing_alg_values_supported: import("../../index.ts").JwtAlgorithm[];
}>;
//# sourceMappingURL=openid-configuration.d.ts.map