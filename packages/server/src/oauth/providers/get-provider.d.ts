import type {
  ProviderCredentials,
  ProvidersOptions
} from "../../core/auth-server-options.ts"
import type { OAuthProvider } from "./oauth-provider.ts"
/**
 * Names that can never be a provider.
 *
 * `guest` is a literal path under `/sign-in`, so a provider by that name would
 * shadow it.
 */
export declare const RESERVED_PROVIDER_NAMES: string[]
/**
 * Looks up a configured provider by the name in the URL.
 *
 * Returns nothing for a provider that exists in code but has no credentials, so
 * an unconfigured provider is indistinguishable from one that was never
 * implemented — both are simply not there.
 */
export declare function getProvider(
  providers: ProvidersOptions,
  name: string
):
  | {
      provider: OAuthProvider
      credentials: ProviderCredentials
    }
  | undefined
//# sourceMappingURL=get-provider.d.ts.map
