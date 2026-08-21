import { vi } from "vitest"

/** One recorded request the client made. */
export interface RecordedRequest {
  method: string
  path: string
  body: unknown
  credentials: RequestCredentials | undefined
  acceptLanguage: string | null
}

/** A queued reply, matched by method and path. */
export interface StubbedReply {
  status?: number
  body?: unknown
  /** Throw a network failure instead of replying. */
  networkError?: boolean
}

/** A minimal fake of the auth server, for driving the client. */
export interface FakeAuthServer {
  requests: RecordedRequest[]
  /** Queues a reply for matching requests; queue several to script a sequence. */
  on(
    method: string,
    path: string,
    reply: StubbedReply | (() => StubbedReply)
  ): void
  restore(): void
}

/** Builds an unsigned JWT with the given lifetime, which is all the client reads. */
export function fakeAccessToken({
  issuedAt = Date.now(),
  lifetimeSeconds = 600
} = {}) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  const payload = {
    sub: "user-1",
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor(issuedAt / 1000) + lifetimeSeconds
  }

  return `${encode({ alg: "RS256", kid: "main" })}.${encode(payload)}.signature-not-checked-by-the-browser`
}

/**
 * Replaces `fetch` with a scripted auth server.
 *
 * A fake rather than the real server on purpose: what is under test here is
 * caching, single-flight, and what happens to local state on each kind of
 * failure — which needs a server that can be made to fail on demand.
 */
export function fakeAuthServer(): FakeAuthServer {
  const requests: RecordedRequest[] = []
  const replies = new Map<string, Array<StubbedReply | (() => StubbedReply)>>()

  const key = (method: string, path: string) => `${method} ${path}`

  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      // The client sends same-origin paths by default, so a base is required here.
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      const url = new URL(raw, globalThis.location?.href ?? "http://localhost")
      const method = init?.method ?? "GET"
      const headers = new Headers(init?.headers)

      requests.push({
        method,
        path: url.pathname,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
        credentials: init?.credentials,
        acceptLanguage: headers.get("accept-language")
      })

      const queue = replies.get(key(method, url.pathname)) ?? []
      const next = queue.length > 1 ? queue.shift() : queue[0]
      const reply = typeof next === "function" ? next() : next

      if (!reply) {
        return new Response(
          JSON.stringify({ error: { code: "notFound", message: "No stub." } }),
          { status: 404 }
        )
      }
      if (reply.networkError) throw new TypeError("Failed to fetch")

      const status = reply.status ?? 200
      if (status === 204) return new Response(null, { status })

      return new Response(JSON.stringify(reply.body ?? {}), {
        status,
        headers: { "content-type": "application/json" }
      })
    })

  return {
    requests,
    on(method, path, reply) {
      const existing = replies.get(key(method, path)) ?? []
      replies.set(key(method, path), [...existing, reply])
    },
    restore: () => spy.mockRestore()
  }
}
