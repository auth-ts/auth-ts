import type { AuthIdentity } from "../../../core/auth-db"
import type { AuthServerInternals } from "../../../core/auth-server-internals"
import { AuthApiError, notFound } from "../../../http/auth-api-error"
import { defineEndpoint } from "../../../http/define-endpoint"
import { decryptSecret } from "../../../lib/encrypt"
import { selectOne } from "../../../lib/select-one"
import { encryptTokens } from "../../../oauth/link-identity"
import { getProvider } from "../../../oauth/providers/get-provider"
import type { ProviderTokens } from "../../../oauth/providers/oauth-provider"
import { PROVIDER_DEADLINE_MS } from "../../../oauth/providers/provider-response"
import type { EndpointDocs } from "../../../openapi/endpoint-docs"
import type { CallerInput } from "../../../session/authenticate"
import { authenticate } from "../../../session/authenticate"

/**
 * How much of an access token's remaining life is treated as already spent.
 *
 * A token that expires in ten seconds is no use to a caller who still has to
 * make a request with it, so it is refreshed early rather than handed over to
 * fail somewhere the failure is harder to read.
 */
const EXPIRY_SKEW_MS = 60_000

/** Input for reading a live provider access token. */
export interface GetProviderTokenInput extends CallerInput {
  /** The identity's own id, from `GET /identities`. */
  id: string
}

/** A live provider access token, and what is known about it. */
export interface ProviderTokenResult {
  token: string
  /** When it expires, or `null` for a provider whose tokens do not. */
  expiresAt: Date | null
  /** The scopes actually granted, space-delimited. */
  scope: string | null
}

/** How `GET /identities/$id/token` appears in the OpenAPI document. */
export const getProviderTokenDocs: EndpointDocs<GetProviderTokenInput, "id"> = {
  description:
    "Refreshes the token if needed. Reconnect the provider if it answers providerReconnectRequired.",
  tag: "Identities",
  auth: "bearer",
  params: { id: "The identity's id, from `GET /identities`." },
  responses: {
    200: { description: "A live access token.", schema: "ProviderToken" },
    401: "Unauthenticated",
    404: "NotFound"
  }
}

/**
 * Get an access token for a provider.
 *
 * This is what makes a connection worth keeping: the application calls Google
 * or GitHub as the user, for as long as the grant lives, without sending them
 * back through a consent screen. The durable half of the grant never leaves the
 * server — only this short-lived token does, which is the same posture as the
 * library's own access token, and short enough that handing it to the browser
 * for a direct CORS call to the provider is a reasonable thing to do.
 *
 * @throws {AuthApiError} `notFound` when the caller has no such identity, and
 * `providerReconnectRequired` when the grant cannot produce a token any more.
 */
export const getProviderToken = defineEndpoint({
  method: "GET",
  path: "/identities/$id/token",
  parse: ({ request, params }): GetProviderTokenInput => ({
    id: params.id ?? "",
    headers: request.headers
  }),
  run: async (internals, input: GetProviderTokenInput) => {
    const caller = await authenticate(internals, input)

    const identity = await selectOne(internals, "identities", {
      id: input.id,
      userId: caller.userId
    })
    if (!identity) throw notFound()

    const stored = await liveAccessToken(internals, identity)
    if (stored) {
      return {
        data: {
          token: stored,
          expiresAt: identity.accessTokenExpiresAt ?? null,
          scope: identity.scope ?? null
        } satisfies ProviderTokenResult
      }
    }

    return { data: await refreshProviderToken(internals, identity) }
  }
})

/**
 * The stored access token, when it is still worth using.
 *
 * A missing expiry means the provider issues tokens that do not expire — a
 * GitHub OAuth App does — so the absence is "good indefinitely", not "unknown".
 * A token this secret can no longer decrypt reads the same as no token: the
 * refresh path below re-mints one, and only fails if that is impossible too.
 */
function liveAccessToken(
  internals: AuthServerInternals,
  identity: AuthIdentity
) {
  if (!identity.accessTokenEncrypted) return null

  const expiry = identity.accessTokenExpiresAt
  if (expiry && expiry.getTime() <= Date.now() + EXPIRY_SKEW_MS) return null

  return decryptSecret(internals.config.secret, identity.accessTokenEncrypted)
}

/** Trades the stored refresh token for a fresh grant, and records what comes back. */
async function refreshProviderToken(
  internals: AuthServerInternals,
  identity: AuthIdentity
): Promise<ProviderTokenResult> {
  const configured = getProvider(internals.config.providers, identity.provider)
  const refreshToken = identity.refreshTokenEncrypted
    ? await decryptSecret(
        internals.config.secret,
        identity.refreshTokenEncrypted
      )
    : null

  if (
    !configured?.provider.refreshAccessToken ||
    !refreshToken ||
    (identity.refreshTokenExpiresAt &&
      identity.refreshTokenExpiresAt.getTime() <= Date.now())
  ) {
    throw new AuthApiError("providerReconnectRequired", 403)
  }

  let tokens: ProviderTokens
  try {
    tokens = await configured.provider.refreshAccessToken({
      credentials: configured.credentials,
      refreshToken,
      signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS)
    })
  } catch (error) {
    if (
      error instanceof AuthApiError &&
      error.code === "providerReconnectRequired"
    ) {
      await internals.db.update({
        table: "identities",
        where: { id: identity.id },
        values: {
          accessTokenEncrypted: null,
          accessTokenExpiresAt: null,
          refreshTokenEncrypted: null,
          refreshTokenExpiresAt: null,
          scope: null,
          updatedAt: new Date()
        }
      })
      internals.log.warn("provider grant is gone, cleared its tokens", {
        provider: identity.provider
      })
    }
    throw error
  }

  if (!tokens.accessToken) {
    throw new AuthApiError("providerReconnectRequired", 403)
  }

  await internals.db.update({
    table: "identities",
    where: { id: identity.id },
    values: {
      ...(await encryptTokens(internals.config.secret, tokens)),
      updatedAt: new Date()
    }
  })

  return {
    token: tokens.accessToken,
    expiresAt: tokens.accessTokenExpiresAt ?? null,
    scope: tokens.scope ?? identity.scope ?? null
  }
}
