import type {
  ProviderCredentials,
  ProvidersOptions
} from "../../core/auth-server-options"
import { github } from "./github"
import { google } from "./google"
import type { OAuthProvider } from "./oauth-provider"

const PROVIDERS: Record<string, OAuthProvider> = { github, google }

/**
 * Looks up a configured provider by the name in the URL.
 *
 * No name is reserved. Every credential type sits at its own literal path —
 * `/sign-in/code`, `/sign-in/guest` — while providers live one level down under
 * `/sign-in/provider/:provider`, so a provider called `guest` collides with
 * nothing. A blacklist would only be a rule someone has to remember the next
 * time a literal path is added.
 *
 * Returns nothing for a provider that exists in code but has no credentials, so
 * an unconfigured provider is indistinguishable from one that was never
 * implemented — both are simply not there.
 *
 * Own properties only: the name is a URL segment, and plain bracket access would
 * let `/sign-in/provider/constructor` resolve `Object` from the prototype chain
 * on both records and answer 500 instead of 404.
 */
export function getProvider(providers: ProvidersOptions, name: string) {
  if (!Object.hasOwn(PROVIDERS, name) || !Object.hasOwn(providers, name)) {
    return undefined
  }

  const credentials = (
    providers as Record<string, ProviderCredentials | undefined>
  )[name]
  const provider = PROVIDERS[name]
  if (!credentials || !provider) return undefined

  return { provider, credentials }
}
