import { afterEach, describe, expect, it, vi } from "vitest"
import { buildOpenAPIDocument } from "../../src/openapi/build-document"
import type { JsonSchema } from "../../src/openapi/json-schema"
import { createTestServer } from "../helpers/create-test-server"
import {
  mintToken,
  readRefreshCookie,
  readSetCookies,
  request,
  STATE_COOKIE
} from "../helpers/request"
import { required } from "../helpers/required"
import { selectRow } from "../helpers/rows"
import { decodeState } from "../helpers/state-cookie"
import { stubGitHub } from "../helpers/stub-provider-network"

const OAUTH_OPTIONS = {
  baseURL: "https://app.example.com",
  providers: {
    github: { clientId: "client-id", clientSecret: "client-secret" }
  }
}

const verifiedEmails = (email: string) => [
  { email, primary: true, verified: true }
]

afterEach(() => {
  vi.restoreAllMocks()
})

type TestContext = Awaited<ReturnType<typeof createTestServer>>

/** Signs in through GitHub, returning the refresh cookie and the identity row. */
async function signInWithGitHub(
  context: TestContext,
  identity: Parameters<typeof stubGitHub>[0]
) {
  const startResponse = await context.auth.handler(
    request("POST", "/api/auth/sign-in/provider/github")
  )
  const stateCookie = required(
    readSetCookies(startResponse).get(STATE_COOKIE),
    "state"
  ).value
  const { state } = decodeState(stateCookie)

  stubGitHub(identity)
  const callbackResponse = await context.auth.handler(
    request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
      cookies: { [STATE_COOKIE]: stateCookie }
    })
  )
  vi.restoreAllMocks()

  const refreshToken = required(
    readRefreshCookie(callbackResponse),
    "refresh"
  ).value
  const stored = required(
    await selectRow(context.db, "identities", { provider: { eq: "github" } }),
    "identity"
  )
  const secrets = required(
    await selectRow(context.db, "identitySecrets", {
      identityId: { eq: stored.id }
    }),
    "identity secrets"
  )

  return { refreshToken, identity: stored, secrets }
}

const GRANT = {
  id: 4242,
  emails: verifiedEmails("ada@example.com"),
  token: "provider-access-token",
  grant: {
    refresh_token: "provider-refresh-token",
    expires_in: 3600,
    scope: "read:user user:email repo"
  }
}

describe("storing a provider grant", () => {
  it("stores the tokens as the provider sent them, in the secrets table only", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity, secrets } = await signInWithGitHub(context, GRANT)

    expect(secrets.accessToken).toBe("provider-access-token")
    expect(secrets.refreshToken).toBe("provider-refresh-token")
    expect(JSON.stringify(identity)).not.toContain("provider-access-token")
    expect(JSON.stringify(identity)).not.toContain("provider-refresh-token")
  })

  it("records the granted scope and the expiry, which are not secrets", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity, secrets } = await signInWithGitHub(context, GRANT)

    expect(identity.scope).toBe("read:user user:email repo")
    expect(secrets.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
  })

  it("refreshes the stored grant on a later sign-in, label unchanged", async () => {
    // The label is what the old update was keyed on, so a sign-in that changes
    // nothing about the name is exactly the case a token write can be lost in.
    const context = await createTestServer(OAUTH_OPTIONS)
    const first = await signInWithGitHub(context, GRANT)

    const second = await signInWithGitHub(context, {
      ...GRANT,
      token: "second-access-token",
      grant: { ...GRANT.grant, refresh_token: "second-refresh-token" }
    })

    expect(second.identity.id).toBe(first.identity.id)
    expect(second.secrets.accessToken).toBe("second-access-token")
    expect(second.secrets.refreshToken).toBe("second-refresh-token")
  })

  it.each([false, true])(
    "replaces access expiry on a later sign-in, rotating refresh token %s",
    async (rotate) => {
      const context = await createTestServer(OAUTH_OPTIONS)
      const first = await signInWithGitHub(context, {
        ...GRANT,
        grant: {
          ...GRANT.grant,
          expires_in: 1,
          refresh_token_expires_in: 86400
        }
      })
      const originalRefreshExpiry = first.secrets.refreshTokenExpiresAt
      const second = await signInWithGitHub(context, {
        ...GRANT,
        token: "replacement-access-token",
        grant: rotate ? { refresh_token: "replacement-refresh-token" } : {}
      })

      expect(second.identity.id).toBe(first.identity.id)
      expect(second.secrets.accessToken).toBe("replacement-access-token")
      expect(second.secrets.accessTokenExpiresAt).toBeNull()
      expect(second.secrets.refreshToken).toBe(
        rotate ? "replacement-refresh-token" : "provider-refresh-token"
      )
      expect(second.secrets.refreshTokenExpiresAt).toEqual(
        rotate ? null : originalRefreshExpiry
      )
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      const response = await context.auth.handler(
        request("GET", `/api/auth/identities/${second.identity.id}/token`, {
          token: await mintToken(context.auth, second.refreshToken)
        })
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        token: "replacement-access-token",
        expiresAt: null,
        scope: GRANT.grant.scope
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  it("keeps every token column out of identities, so the table reads whole", async () => {
    // What makes `identities` safe for an application to select without naming
    // columns: there is nothing on the row to leave out.
    const context = await createTestServer(OAUTH_OPTIONS)
    await signInWithGitHub(context, GRANT)

    const identity = required(
      await selectRow(context.db, "identities", { provider: { eq: "github" } }),
      "identity"
    )

    expect(Object.keys(identity).sort()).toEqual([
      "createdAt",
      "id",
      "label",
      "provider",
      "providerUserId",
      "scope",
      "updatedAt",
      "userId"
    ])
    // The parts an account screen legitimately renders survive.
    expect(identity.scope).toBe("read:user user:email repo")
  })
})

describe("GET /identities/:id/token", () => {
  const tokenRequest = async (
    context: TestContext,
    refreshToken: string,
    id: string
  ) =>
    context.auth.handler(
      request("GET", `/api/auth/identities/${id}/token`, {
        token: await mintToken(context.auth, refreshToken)
      })
    )

  it.each([false, true])(
    "matches stored provider metadata with the schema, dated %s",
    async (dated) => {
      const context = await createTestServer(OAUTH_OPTIONS)
      const { refreshToken, identity, secrets } = await signInWithGitHub(
        context,
        {
          ...GRANT,
          grant: dated ? GRANT.grant : {}
        }
      )
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      const response = await tokenRequest(context, refreshToken, identity.id)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        token: GRANT.token,
        expiresAt: dated ? secrets.accessTokenExpiresAt?.toISOString() : null,
        scope: dated ? GRANT.grant.scope : null
      })
      const schemas = buildOpenAPIDocument(context.auth.config).components
        .schemas as Record<string, JsonSchema>
      const schema = required(schemas.ProviderToken, "provider schema")
      expect(schema.required).toEqual(["token", "expiresAt", "scope"])
      expect(schema.properties?.expiresAt).toMatchObject({
        oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
      })
      expect(schema.properties?.scope).toMatchObject({
        oneOf: [{ type: "string" }, { type: "null" }]
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    "clears replaced access expiry and avoids a second refresh, scope known %s",
    async (knownScope) => {
      const context = await createTestServer(OAUTH_OPTIONS)
      const { refreshToken, identity } = await signInWithGitHub(context, {
        ...GRANT,
        grant: {
          refresh_token: GRANT.grant.refresh_token,
          refresh_token_expires_in: 86400,
          expires_in: 1,
          ...(knownScope ? { scope: GRANT.grant.scope } : {})
        }
      })
      const expiry = new Date(Date.now() - 60000)
      await context.db.update({
        table: "identitySecrets",
        where: { identityId: { eq: identity.id } },
        values: { accessTokenExpiresAt: expiry }
      })
      const before = required(
        await selectRow(context.db, "identitySecrets", {
          identityId: { eq: identity.id }
        }),
        "original grant"
      )
      const fetchSpy = stubGitHub({
        ...GRANT,
        refreshed: { access_token: "fresh-access-token" }
      })
      const expected = {
        token: "fresh-access-token",
        expiresAt: null,
        scope: knownScope ? GRANT.grant.scope : null
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await tokenRequest(context, refreshToken, identity.id)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expected)
      }
      const stored = required(
        await selectRow(context.db, "identitySecrets", {
          identityId: { eq: identity.id }
        }),
        "stored grant"
      )
      expect(stored.accessToken).toBe(expected.token)
      expect(stored.accessTokenExpiresAt).toBeNull()
      expect(stored.refreshToken).toBe(before.refreshToken)
      expect(stored.refreshTokenExpiresAt).toEqual(before.refreshTokenExpiresAt)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    }
  )

  it("clears the old expiry when the refresh token rotates without expiry", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, {
      ...GRANT,
      grant: { ...GRANT.grant, expires_in: 1, refresh_token_expires_in: 86400 }
    })
    stubGitHub({
      ...GRANT,
      refreshed: {
        access_token: "fresh-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600
      }
    })
    const response = await tokenRequest(context, refreshToken, identity.id)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { expiresAt: string; scope: string }
    const stored = required(
      await selectRow(context.db, "identitySecrets", {
        identityId: { eq: identity.id }
      }),
      "stored grant"
    )
    expect(stored.refreshToken).toBe("rotated-refresh-token")
    expect(stored.refreshTokenExpiresAt).toBeNull()
    expect(stored.accessTokenExpiresAt?.toISOString()).toBe(body.expiresAt)
    expect(body.scope).toBe(GRANT.grant.scope)
  })

  it("returns the stored token without calling the provider", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, GRANT)
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const response = await tokenRequest(context, refreshToken, identity.id)
    const body = (await response.json()) as { token: string; scope: string }

    expect(response.status).toBe(200)
    expect(body.token).toBe("provider-access-token")
    expect(body.scope).toBe("read:user user:email repo")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("refreshes a spent token and writes the new grant back", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, {
      ...GRANT,
      grant: { ...GRANT.grant, expires_in: 1 }
    })
    stubGitHub({
      ...GRANT,
      refreshed: {
        access_token: "refreshed-access-token",
        expires_in: 3600,
        scope: "read:user user:email repo"
      }
    })

    const response = await tokenRequest(context, refreshToken, identity.id)
    const body = (await response.json()) as { token: string }

    expect(body.token).toBe("refreshed-access-token")
    const stored = required(
      await selectRow(context.db, "identitySecrets", {
        identityId: { eq: identity.id }
      }),
      "identity"
    )
    expect(stored.accessToken).toBe("refreshed-access-token")
  })

  it("stores a rotated refresh token, so the next refresh still works", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, {
      ...GRANT,
      grant: { ...GRANT.grant, expires_in: 1 }
    })
    stubGitHub({
      ...GRANT,
      refreshed: {
        access_token: "refreshed-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600
      }
    })

    await tokenRequest(context, refreshToken, identity.id)

    const stored = required(
      await selectRow(context.db, "identitySecrets", {
        identityId: { eq: identity.id }
      }),
      "identity"
    )
    expect(stored.refreshToken).toBe("rotated-refresh-token")
  })

  it("clears the grant and asks for a reconnect once the provider forgets it", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, {
      ...GRANT,
      grant: { ...GRANT.grant, expires_in: 1 }
    })
    // GitHub reports a dead grant as a 200 with no access token in it.
    stubGitHub({ ...GRANT, refreshed: {} })

    const response = await tokenRequest(context, refreshToken, identity.id)

    expect(response.status).toBe(403)
    expect(((await response.json()) as { code: string }).code).toBe(
      "providerReconnectRequired"
    )
    // The identity stays — the account is still linked — but every trace of a
    // grant it no longer has goes, ciphertext row included.
    expect(
      await selectRow(context.db, "identitySecrets", {
        identityId: { eq: identity.id }
      })
    ).toBeNull()
    const stored = required(
      await selectRow(context.db, "identities", { id: { eq: identity.id } }),
      "identity"
    )
    expect(stored.scope).toBeNull()
  })

  it("asks for a reconnect when there was never a refresh token", async () => {
    // A classic OAuth App: one non-expiring access token and nothing to refresh
    // with. Fine until the token is revoked, and unrecoverable after.
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, {
      id: 4242,
      emails: verifiedEmails("ada@example.com"),
      token: "provider-access-token"
    })
    await context.db.update({
      table: "identitySecrets",
      where: { identityId: { eq: identity.id } },
      values: { accessToken: null }
    })

    const response = await tokenRequest(context, refreshToken, identity.id)

    expect(response.status).toBe(403)
  })

  it("404s on someone else's identity, so ids cannot be probed", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    await context.auth.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "grace@example.com" }
      })
    )
    const verified = await context.auth.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const { token } = (await verified.json()) as { token: string }

    const response = await context.auth.handler(
      request("GET", `/api/auth/identities/${identity.id}/token`, { token })
    )

    expect(response.status).toBe(404)
  })

  it("refuses an unauthenticated caller", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    const response = await context.auth.handler(
      request("GET", `/api/auth/identities/${identity.id}/token`)
    )

    expect(response.status).toBe(401)
  })

  it("refuses a token whose session was signed out", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, GRANT)
    const token = await mintToken(context.auth, refreshToken)

    await context.auth.handler(
      request("POST", "/api/auth/sign-out", {
        token,
        body: { scope: "global" }
      })
    )

    const response = await context.auth.handler(
      request("GET", `/api/auth/identities/${identity.id}/token`, { token })
    )

    expect(context.db.sessions()).toHaveLength(0)
    expect(response.status).toBe(401)

    // The token itself is still live.
    const stateless = await context.auth.handler(
      request("POST", "/api/auth/user", { token, body: { name: "Ada" } })
    )

    expect(stateless.status).toBe(200)
  })
})

describe("getProviderRefreshToken", () => {
  it("decrypts the durable half for server-side callers only", async () => {
    // Server-only by construction: there is no route that serves this, which is
    // the point of it not being in the registry.
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    expect(await context.auth.getProviderRefreshToken(identity.id)).toBe(
      "provider-refresh-token"
    )
    expect(
      await context.auth.getProviderRefreshToken("no-such-identity")
    ).toBeNull()
  })
})
