# Auth.ts

**Free forever JWT auth in TypeScript — four functions to write against any database.**
No limits, no service, no company.

For applications that issue **their own** RS256 or ES256 tokens, for PostgREST
and row-level-security backends — Neon's Data API, Supabase, self-hosted
PostgREST — or anything that trusts a JWKS URL. Your database verifies the token
and your policies decide what comes back, so authorization lives in Postgres
rather than in application code.

* `@auth-ts/server` — the issuer. Zero framework dependencies, zero database
  dependencies, `jose` and nothing else. Runs on Node 20+, Cloudflare Workers,
  Deno, and Bun.
* `@auth-ts/client` — browser token management. Zero runtime dependencies.
* `@auth-ts/cli` — `npx @auth-ts/cli keygen`: the signing key, the
  `AUTH_SECRET`, and the `public/jwks.json` to deploy with your app.

Sign-in methods: email or SMS verification codes, GitHub, Google, and anonymous guests.

## Quickstart

```bash
bun add @auth-ts/server @auth-ts/client
npx @auth-ts/cli keygen >> .env
```

`keygen` prints `JWT_PRIVATE_KEY` and `AUTH_SECRET`, and writes the public key
set to `public/jwks.json` — which your framework serves at `/jwks.json`.

```ts
// auth-server.ts
import { createAuthServer } from "@auth-ts/server"

export const authServer = createAuthServer({
  db: {
    /* four functions — see the AuthDB reference */
  },
  email: {
    sendCode: async ({ email, code }) => {
      await yourEmailProvider.send({ to: email, text: code })
    }
  }
})

export type AuthServer = typeof authServer
```

Mount it once, at `<basePath>/*`:

```ts
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => authServer.handler(request),
      POST: ({ request }) => authServer.handler(request),
      PATCH: ({ request }) => authServer.handler(request),
      DELETE: ({ request }) => authServer.handler(request)
    }
  }
})
```

Then point your database at `https://your.app/jwks.json`, and in the browser:

```ts
import { createAuthClient } from "@auth-ts/client"

export const authClient = createAuthClient()

await authClient.sendCode({ email })
await authClient.verifyCode({ email, code })

// Hand this to your PostgREST client.
const token = await authClient.getToken()
```

## Why no adapter packages

Adapters are a promise to track someone else's schema conventions forever, and
they always leak. Instead there are four functions — `select`, `insert`,
`update`, `delete`, filtered by equality on columns the library names — plus an
optional sweep. It is the same code an adapter would generate, except you can
read it and it is already written against your own tables. That is the whole
integration surface, and it is where the semver discipline goes.

## Design in one paragraph

The refresh token is the session: 32 random bytes, delivered only as an
`HttpOnly`, `Secure`, `SameSite=Lax` cookie, stored by you as a SHA-256 hash. The
access token is a short-lived JWT held in a JavaScript variable and never
persisted, because a stored bearer token turns any XSS into an exfiltratable
credential. Revocation latency is therefore the access-token lifetime — ten
minutes by default — which is stated plainly rather than glossed over.

## Repository

```text
packages/server    @auth-ts/server
packages/client    @auth-ts/client
packages/cli       @auth-ts/cli
apps/docs          the documentation site
examples/          TanStack Start + Neon reference application
```

```bash
bun install
bun x nx run-many -t typecheck test build
```

## What is not here yet

[ROADMAP.md](ROADMAP.md) covers what is deliberately deferred, what is built but
not yet proven against a live provider, and what this project declines to build
at all — with the reasoning, so the decisions can be argued with rather than
guessed at.

## Documentation

[authts.dev](https://authts.dev)

## Licence

Apache-2.0.