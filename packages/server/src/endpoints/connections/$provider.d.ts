/** Input for unlinking a provider. */
export interface DisconnectProviderInput {
  provider: string
  headers?: Headers
}
/**
 * Unlinks a provider from the signed-in user.
 *
 * Refuses when it is the last way in. Counting the remaining methods — email,
 * phone number, and any other linked provider — is the difference between a
 * settings screen and a trapdoor: without this check, a user who signed up with
 * GitHub and never added an email can remove GitHub and lock themselves out of
 * their own data permanently.
 */
export declare const disconnectProvider: import("../../http/define-endpoint.ts").EndpointDefinition<
  DisconnectProviderInput,
  undefined
>
//# sourceMappingURL=$provider.d.ts.map
