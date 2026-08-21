/**
 * Every endpoint, keyed by the name it is exposed under.
 *
 * One table, three consumers: the callables on `authServer`, the handlers in
 * `authServer.handlers`, and the dispatch table behind `authServer.handler`.
 * Adding an endpoint here adds it to all three, which is the point — there is no
 * second list to forget.
 *
 * Names are derived from the route, so `GET /connect/:provider` is
 * `connectProvider` and reading either one tells you the other.
 */
export declare const endpointRegistry: {
    readonly sendCode: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").SendCodeInput, {
        sent: boolean;
    }>;
    readonly verifyCode: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").VerifyCodeInput, {
        accessToken: string;
        user: import("./auth-db.ts").AuthUser;
        refreshToken?: string | undefined;
    }>;
    readonly getToken: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").HeadersInput, {
        accessToken: string;
        user: import("./auth-db.ts").AuthUser;
        session: import("./auth-db.ts").AuthSession;
    }>;
    readonly logout: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").LogoutInput, {
        switchedTo: import("./auth-db.ts").AuthUser;
        accessToken: string;
    } | undefined>;
    readonly getUser: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").HeadersInput, {
        user: import("./auth-db.ts").AuthUser;
    }>;
    readonly updateUser: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").UpdateUserInput, {
        user: import("./auth-db.ts").AuthUser;
    }>;
    readonly deleteUser: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").DeleteUserInput, undefined>;
    readonly listSessions: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").HeadersInput, {
        sessions: import("../index.ts").SessionInfo[];
    }>;
    readonly revokeSession: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").RevokeSessionInput, undefined>;
    readonly listAccounts: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").ListAccountsInput, {
        accounts: import("../index.ts").AccountInfo[];
    }>;
    readonly switchAccount: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").SwitchAccountInput, {
        accessToken: string;
        user: import("./auth-db.ts").AuthUser;
    }>;
    readonly signInGuest: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").SignInGuestInput, {
        accessToken: string;
        user: import("./auth-db.ts").AuthUser;
        refreshToken?: string | undefined;
    }>;
    readonly signInProvider: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").SignInProviderInput, undefined>;
    readonly callbackProvider: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").CallbackProviderInput, undefined>;
    readonly connectProvider: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").ConnectProviderInput, undefined>;
    readonly listConnections: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").HeadersInput, {
        connections: import("../index.ts").ConnectionInfo[];
    }>;
    readonly disconnectProvider: import("../http/define-endpoint.ts").EndpointDefinition<import("../index.ts").DisconnectProviderInput, undefined>;
    readonly getJwks: import("../http/define-endpoint.ts").EndpointDefinition<unknown, import("../jwt/build-jwks.ts").Jwks>;
    readonly getDiscovery: import("../http/define-endpoint.ts").EndpointDefinition<unknown, {
        issuer: string;
        jwks_uri: string;
        response_types_supported: string[];
        subject_types_supported: string[];
        id_token_signing_alg_values_supported: import("../index.ts").JwtAlgorithm[];
    }>;
};
/** The registry's shape, used to type the derived surfaces. */
export type EndpointRegistry = typeof endpointRegistry;
//# sourceMappingURL=endpoint-registry.d.ts.map