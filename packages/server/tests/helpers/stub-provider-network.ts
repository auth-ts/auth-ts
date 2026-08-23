import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { vi } from "vitest"

/** What the fake GitHub should answer with. */
export interface StubGitHubIdentity {
  id: number
  name?: string
  login?: string
  avatarURL?: string
  emails?: Array<{ email: string; primary: boolean; verified: boolean }>
  /** Omit the token to simulate a rejected code exchange. */
  token?: string | null
  /** HTTP statuses to answer with instead of 200, per endpoint. */
  status?: { token?: number; profile?: number; emails?: number }
  /** Extra response headers, per endpoint — GitHub signals rate limits this way. */
  headers?: {
    token?: Record<string, string>
    profile?: Record<string, string>
    emails?: Record<string, string>
  }
}

/**
 * Replaces `fetch` with a fake GitHub.
 *
 * The provider modules are the security boundary for verified email, so tests
 * drive the real module and only fake the network underneath it — a stubbed
 * provider would test nothing.
 */
export function stubGitHub(identity: StubGitHubIdentity) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    if (url.includes("login/oauth/access_token")) {
      return jsonResponse(
        identity.token === null
          ? {}
          : { access_token: identity.token ?? "provider-token" },
        identity.status?.token,
        identity.headers?.token
      )
    }

    if (url.endsWith("/user/emails")) {
      return jsonResponse(
        identity.emails ?? [],
        identity.status?.emails,
        identity.headers?.emails
      )
    }

    if (url.endsWith("api.github.com/user")) {
      return jsonResponse(
        {
          id: identity.id,
          name: identity.name ?? null,
          login: identity.login ?? "octocat",
          avatar_url: identity.avatarURL ?? null
        },
        identity.status?.profile,
        identity.headers?.profile
      )
    }

    throw new Error(`Unexpected fetch in test: ${url}`)
  })
}

/** What the fake Google should answer with. */
export interface StubGoogleIdentity {
  sub: string
  email?: string
  emailVerified?: boolean
  name?: string
  picture?: string
  /** Overrides for the ID token, to forge one that must be refused. */
  token?: {
    issuer?: string
    audience?: string
    /** Seconds from now; negative for an already-expired token. */
    expiresIn?: number
    /** Sign with a key Google's JWKS does not publish. */
    wrongKey?: boolean
    /** Hand back something that is not a JWT at all. */
    malformed?: boolean
    /** Leave these claims out, for tokens that are signed but incomplete. */
    omit?: ReadonlyArray<"exp" | "iat" | "sub">
  }
  /** HTTP statuses to answer with instead of 200, per endpoint. */
  status?: { token?: number; jwks?: number }
  /**
   * The `nonce` claim to put in the ID token. Full-flow tests copy it out of
   * the state cookie so the token matches; a test can also set a wrong one.
   */
  nonce?: string
}

const GOOGLE_KID = "test-google-kid"

/** One signing key per test process, so jose's JWKS cache never sees two. */
const googleSigningKeys = generateKeyPair("RS256", { extractable: true })
const strangerKeys = generateKeyPair("RS256", { extractable: true })

/**
 * Replaces `fetch` with a fake Google: the token endpoint mints a real RS256
 * ID token, and the JWKS endpoint publishes the key that signed it. That is
 * what lets the real provider module run its real verification in tests.
 */
export function stubGoogle(identity: StubGoogleIdentity) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    if (url.includes("oauth2.googleapis.com/token")) {
      return jsonResponse(
        { id_token: await mintGoogleIdToken(identity) },
        identity.status?.token
      )
    }

    if (url.includes("googleapis.com/oauth2/v3/certs")) {
      const { publicKey } = await googleSigningKeys
      const jwk = await exportJWK(publicKey)
      return jsonResponse(
        { keys: [{ ...jwk, kid: GOOGLE_KID, alg: "RS256", use: "sig" }] },
        identity.status?.jwks
      )
    }

    throw new Error(`Unexpected fetch in test: ${url}`)
  })
}

async function mintGoogleIdToken(identity: StubGoogleIdentity) {
  const overrides = identity.token ?? {}
  if (overrides.malformed) return "not-a-jwt"

  const { privateKey } = await (overrides.wrongKey
    ? strangerKeys
    : googleSigningKeys)
  const now = Math.floor(Date.now() / 1000)
  const omitted = new Set(overrides.omit ?? [])

  const jwt = new SignJWT({
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.emailVerified === undefined
      ? {}
      : { email_verified: identity.emailVerified }),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.picture ? { picture: identity.picture } : {}),
    ...(identity.nonce ? { nonce: identity.nonce } : {})
  })
    .setProtectedHeader({ alg: "RS256", kid: GOOGLE_KID })
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? "client-id")
  if (!omitted.has("sub")) jwt.setSubject(identity.sub)
  if (!omitted.has("iat")) jwt.setIssuedAt(now)
  if (!omitted.has("exp")) {
    jwt.setExpirationTime(now + (overrides.expiresIn ?? 3600))
  }

  return jwt.sign(privateKey)
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  })
}
