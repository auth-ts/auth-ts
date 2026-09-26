import type { AuthConfig } from "../core/auth-config"

/**
 * Configuration an endpoint depends on.
 *
 * A deployment without it answers 404 on that route, and the OpenAPI document
 * leaves the route out rather than describing something the reader cannot call.
 */
export type EndpointRequirement =
  | "guest"
  | "multiUser"
  | "providers"
  | "jwks"
  | "baseURL"
  | "openapi"

/** Whether this deployment turned the requirement on. */
export function requirementMet(
  config: AuthConfig,
  requirement: EndpointRequirement
) {
  if (requirement === "guest") return config.guest
  if (requirement === "multiUser") return config.multiUser
  if (requirement === "providers")
    return Object.keys(config.providers).length > 0
  if (requirement === "jwks") return config.jwks?.json !== undefined
  if (requirement === "openapi") return config.openapi
  return config.baseURL !== undefined
}
