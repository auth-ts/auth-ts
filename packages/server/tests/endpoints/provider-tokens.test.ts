import { afterEach, describe, expect, it, vi } from "vitest"
import { decryptSecret, encryptSecret } from "../../src/lib/encrypt"
import { createTestServer } from "../helpers/create-test-server"
import { mintToken, readSetCookies, request } from "../helpers/request"
import { required } from "../helpers/required"
import { selectRow } from "../helpers/rows"
import { decodeState } from "../helpers/state-cookie"
import { stubGitHub } from "../helpers/stub-provider-network"

const OAUTH_OPTIONS = {
  baseURL: "https://app.example.com",
  secret: "test-server-secret",
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
  const startResponse = await context.authServer.handler(
    request("POST", "/api/auth/sign-in/provider/github")
  )
  const stateCookie = required(
    readSetCookies(startResponse).get("auth-ts.state"),
    "state"
  ).value
  const { state } = decodeState(stateCookie)

  stubGitHub(identity)
  const callbackResponse = await context.authServer.handler(
    request("GET", `/api/auth/callback/github?code=abc&state=${state}`, {
      cookies: { "auth-ts.state": stateCookie }
    })
  )
  vi.restoreAllMocks()

  const refreshToken = required(
    readSetCookies(callbackResponse).get("auth-ts.refresh"),
    "refresh"
  ).value
  const stored = required(
    await selectRow(context.db, "identities", { provider: "github" }),
    "identity"
  )

  return { refreshToken, identity: stored }
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
  it("keeps the tokens encrypted, never as the provider sent them", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    for (const column of [
      identity.accessTokenEncrypted,
      identity.refreshTokenEncrypted
    ]) {
      expect(column).toMatch(/^v1\./)
    }
    expect(JSON.stringify(identity)).not.toContain("provider-access-token")
    expect(JSON.stringify(identity)).not.toContain("provider-refresh-token")

    expect(
      await decryptSecret(
        context.authServer.config.secret,
        required(identity.accessTokenEncrypted, "access token")
      )
    ).toBe("provider-access-token")
    expect(
      await decryptSecret(
        context.authServer.config.secret,
        required(identity.refreshTokenEncrypted, "refresh token")
      )
    ).toBe("provider-refresh-token")
  })

  it("records the granted scope and the expiry, which are not secrets", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    expect(identity.scope).toBe("read:user user:email repo")
    expect(identity.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
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
    expect(second.identity.accessTokenEncrypted).not.toBe(
      first.identity.accessTokenEncrypted
    )
    expect(
      await decryptSecret(
        context.authServer.config.secret,
        required(second.identity.accessTokenEncrypted, "access token")
      )
    ).toBe("second-access-token")
  })

  it("never lets the tokens reach the browser through GET /identities", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken } = await signInWithGitHub(context, GRANT)

    const response = await context.authServer.handler(
      request("GET", "/api/auth/identities", {
        token: await mintToken(context.authServer, refreshToken)
      })
    )
    const [listed] = (await response.json()) as Array<Record<string, unknown>>

    expect(listed).toBeDefined()
    expect(listed).not.toHaveProperty("accessTokenEncrypted")
    expect(listed).not.toHaveProperty("refreshTokenEncrypted")
    // Not a secret, but not an answer either: the listing holds no token, so
    // its expiry is churn. `getProviderToken` reports the one it hands over.
    expect(listed).not.toHaveProperty("accessTokenExpiresAt")
    // The parts an account screen legitimately renders survive.
    expect(listed?.scope).toBe("read:user user:email repo")
    expect(listed?.provider).toBe("github")
  })
})

describe("GET /identities/:id/token", () => {
  const tokenRequest = async (
    context: TestContext,
    refreshToken: string,
    id: string
  ) =>
    context.authServer.handler(
      request("GET", `/api/auth/identities/${id}/token`, {
        token: await mintToken(context.authServer, refreshToken)
      })
    )

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
      await selectRow(context.db, "identities", { id: identity.id }),
      "identity"
    )
    expect(
      await decryptSecret(
        context.authServer.config.secret,
        required(stored.accessTokenEncrypted, "access token")
      )
    ).toBe("refreshed-access-token")
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
      await selectRow(context.db, "identities", { id: identity.id }),
      "identity"
    )
    expect(
      await decryptSecret(
        context.authServer.config.secret,
        required(stored.refreshTokenEncrypted, "refresh token")
      )
    ).toBe("rotated-refresh-token")
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
    const stored = required(
      await selectRow(context.db, "identities", { id: identity.id }),
      "identity"
    )
    // The row stays — the account is still linked — but it stops claiming a
    // grant it does not have.
    expect(stored.accessTokenEncrypted).toBeNull()
    expect(stored.refreshTokenEncrypted).toBeNull()
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
      table: "identities",
      where: { id: identity.id },
      values: { accessTokenEncrypted: null }
    })

    const response = await tokenRequest(context, refreshToken, identity.id)

    expect(response.status).toBe(403)
  })

  it("treats a token written under a rotated secret as needing a refresh", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { refreshToken, identity } = await signInWithGitHub(context, GRANT)
    await context.db.update({
      table: "identities",
      where: { id: identity.id },
      values: {
        accessTokenEncrypted: await encryptSecret(
          "some-other-secret",
          "unreadable"
        )
      }
    })
    stubGitHub({ ...GRANT, refreshed: { access_token: "refreshed-token" } })

    const response = await tokenRequest(context, refreshToken, identity.id)

    expect(((await response.json()) as { token: string }).token).toBe(
      "refreshed-token"
    )
  })

  it("404s on someone else's identity, so ids cannot be probed", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    await context.authServer.handler(
      request("POST", "/api/auth/sign-in/send-code", {
        body: { email: "grace@example.com" }
      })
    )
    const verified = await context.authServer.handler(
      request("POST", "/api/auth/sign-in/code", {
        body: {
          email: "grace@example.com",
          code: required(context.sentCodes.at(-1), "code").code
        }
      })
    )
    const { token } = (await verified.json()) as { token: string }

    const response = await context.authServer.handler(
      request("GET", `/api/auth/identities/${identity.id}/token`, { token })
    )

    expect(response.status).toBe(404)
  })

  it("refuses an unauthenticated caller", async () => {
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    const response = await context.authServer.handler(
      request("GET", `/api/auth/identities/${identity.id}/token`)
    )

    expect(response.status).toBe(401)
  })
})

describe("getProviderRefreshToken", () => {
  it("decrypts the durable half for server-side callers only", async () => {
    // Server-only by construction: there is no route that serves this, which is
    // the point of it not being in the registry.
    const context = await createTestServer(OAUTH_OPTIONS)
    const { identity } = await signInWithGitHub(context, GRANT)

    expect(await context.authServer.getProviderRefreshToken(identity.id)).toBe(
      "provider-refresh-token"
    )
    expect(
      await context.authServer.getProviderRefreshToken("no-such-identity")
    ).toBeNull()
  })
})
