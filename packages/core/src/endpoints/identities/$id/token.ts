import type { AuthIdentity, AuthIdentitySecret } from "../../../core/auth-db"
import type { AuthInternals } from "../../../core/auth-internals"
import {
  AuthApiError,
  notFound,
  unauthenticated
} from "../../../http/auth-api-error"
import { defineEndpoint } from "../../../http/define-endpoint"
import { decryptSecret } from "../../../lib/encrypt"
import { selectOne } from "../../../lib/select-one"
import {
  encryptTokens,
  storeIdentitySecrets
} from "../../../oauth/link-identity"
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
  /** The identity's own id, from your `identities` table. */
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
  params: { id: "The identity's id, from your `identities` table." },
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
 * server — only the access token does, which is the same posture as the
 * library's own.
 *
 * Where a provider issues tokens that never expire — a GitHub OAuth App does —
 * what this returns is durable rather than short-lived, and nothing the library
 * revokes can reach it afterwards. So this is the one endpoint that confirms
 * the session is still live instead of trusting the access token alone: signing
 * out has to cut off the credential that outlasts signing out.
 *
 * @throws {AuthApiError} `unauthenticated` when the session the token names is
 * gone, `notFound` when the caller has no such identity, and
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

    // One parallel wave — all three keys are known up-front. The secrets read
    // is speculative and discarded unread when the checks below refuse the
    // caller. Provider tokens can outlive this session, hence the session
    // check; the ciphertext lives in its own table so that `identities` needs
    // no column grants to be safe to read.
    const [session, identity, secrets] = await Promise.all([
      selectOne(internals, "sessions", {
        id: { eq: caller.sessionId },
        expiresAt: { gt: new Date() }
      }),
      selectOne(internals, "identities", {
        id: { eq: input.id },
        userId: { eq: caller.userId }
      }),
      selectOne(internals, "identitySecrets", { identityId: { eq: input.id } })
    ])
    if (!session) throw unauthenticated()
    if (!identity) throw notFound()

    const stored = secrets && (await liveAccessToken(internals, secrets))
    if (stored) {
      return {
        data: {
          token: stored,
          expiresAt: secrets?.accessTokenExpiresAt ?? null,
          scope: identity.scope ?? null
        } satisfies ProviderTokenResult
      }
    }

    return { data: await refreshProviderToken(internals, identity, secrets) }
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
  internals: AuthInternals,
  secrets: AuthIdentitySecret
) {
  if (!secrets.accessTokenEncrypted) return null

  const expiry = secrets.accessTokenExpiresAt
  if (expiry && expiry.getTime() <= Date.now() + EXPIRY_SKEW_MS) return null

  return decryptSecret(internals.config.secret, secrets.accessTokenEncrypted)
}

/** Trades the stored refresh token for a fresh grant, and records what comes back. */
async function refreshProviderToken(
  internals: AuthInternals,
  identity: AuthIdentity,
  secrets: AuthIdentitySecret | null
): Promise<ProviderTokenResult> {
  const configured = getProvider(internals.config.providers, identity.provider)
  const refreshToken = secrets?.refreshTokenEncrypted
    ? await decryptSecret(
        internals.config.secret,
        secrets.refreshTokenEncrypted
      )
    : null

  if (
    !configured?.provider.refreshAccessToken ||
    !refreshToken ||
    (secrets?.refreshTokenExpiresAt &&
      secrets.refreshTokenExpiresAt.getTime() <= Date.now())
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
      // The grant is gone at the provider, so what recorded it goes: the
      // ciphertext row, and the scope that described what it bought.
      await internals.db.delete({
        table: "identitySecrets",
        where: { identityId: { eq: identity.id } }
      })
      await internals.db.update({
        table: "identities",
        where: { id: { eq: identity.id } },
        values: { scope: null, updatedAt: new Date() }
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

  const stored = await encryptTokens(internals.config.secret, tokens)
  if (Object.keys(stored.identity).length > 0) {
    await internals.db.update({
      table: "identities",
      where: { id: { eq: identity.id } },
      values: { ...stored.identity, updatedAt: new Date() }
    })
  }
  await storeIdentitySecrets(internals, identity.id, stored.secrets)

  return {
    token: tokens.accessToken,
    expiresAt: tokens.accessTokenExpiresAt ?? null,
    scope: tokens.scope ?? identity.scope ?? null
  }
}
