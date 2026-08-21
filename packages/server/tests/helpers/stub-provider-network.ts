import { vi } from "vitest"

/** What the fake GitHub should answer with. */
export interface StubGitHubIdentity {
  id: number
  name?: string
  login?: string
  avatarURL?: string
  emails?: Array<{ email: string; primary: boolean; verified: boolean }>
  /** Omit the token to simulate a rejected code exchange. */
  accessToken?: string | null
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
        identity.accessToken === null
          ? {}
          : { access_token: identity.accessToken ?? "provider-token" }
      )
    }

    if (url.endsWith("/user/emails")) return jsonResponse(identity.emails ?? [])

    if (url.endsWith("api.github.com/user")) {
      return jsonResponse({
        id: identity.id,
        name: identity.name ?? null,
        login: identity.login ?? "octocat",
        avatar_url: identity.avatarURL ?? null
      })
    }

    throw new Error(`Unexpected fetch in test: ${url}`)
  })
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" }
  })
}
