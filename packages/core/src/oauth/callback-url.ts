import type { AuthConfig } from "../core/auth-config"
import { getBaseURL } from "../lib/get-base-url"

/**
 * The `redirect_uri` for one provider.
 *
 * Built in one place because the value is matched, character for character, in
 * two: the provider records it from the authorize request and refuses the code
 * exchange unless the same string comes back. Two call sites deriving it
 * separately is a token exchange that fails on the origin nobody tested.
 */
export function getCallbackURL(
  config: AuthConfig,
  provider: string,
  requestURL?: string,
  headers?: Headers
) {
  const baseURL = getBaseURL(config, requestURL, headers)
  return `${baseURL}${config.basePath}/callback/${provider}`
}
