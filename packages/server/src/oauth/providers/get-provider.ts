import type {
  ProviderCredentials,
  ProvidersOptions
} from "../../core/auth-server-options.ts"
import { github } from "./github.ts"
import { google } from "./google.ts"
import type { OAuthProvider } from "./oauth-provider.ts"

const PROVIDERS: Record<string, OAuthProvider> = { github, google }

/**
 * Names that can never be a provider.
 *
 * `guest` is a literal path under `/sign-in`, so a provider by that name would
 * shadow it.
 */
export const RESERVED_PROVIDER_NAMES = ["guest"]

/**
 * Looks up a configured provider by the name in the URL.
 *
 * Returns nothing for a provider that exists in code but has no credentials, so
 * an unconfigured provider is indistinguishable from one that was never
 * implemented — both are simply not there.
 */
export function getProvider(providers: ProvidersOptions, name: string) {
  if (RESERVED_PROVIDER_NAMES.includes(name)) return undefined

  const credentials = (
    providers as Record<string, ProviderCredentials | undefined>
  )[name]
  const provider = PROVIDERS[name]
  if (!credentials || !provider) return undefined

  return { provider, credentials }
}
