# auth.ts

**Sign-in, sessions and JWTs for any TypeScript app.**

Free forever. No limits, no service, no company. Built on
[Lucia](https://lucia-auth.com) and [The Copenhagen Book](https://thecopenhagenbook.com).

- Email and SMS codes, GitHub and Google, and guest sign-in
- Sessions, sign-out, device lists and account switching
- Short-lived ES256 or RS256 JWTs, verified in your own routes or by anything
  that trusts a JWKS URL, like Neon, Supabase or PostgREST
- Connected accounts with refreshed provider tokens
- Rate limiting, CSRF protection and code guessing limits
- No adapter packages: six tables and four functions you write
- Runs on Node 20+, Cloudflare Workers, Deno and Bun

## Packages

| package | |
| --- | --- |
| [`@auth-ts/core`](packages/core) | The server, plus the browser client at `@auth-ts/core/client`. Depends only on `jose`. |
| [`@auth-ts/cli`](packages/cli) | `npx @auth-ts/cli keygen` generates your signing key and `jwks.json`. |

## Quickstart

```bash
npm install @auth-ts/core
npx @auth-ts/cli keygen
```

`keygen` saves `JWT_PRIVATE_KEY` to `.env` and the public key set to
`public/jwks.json`.

Create the server. `authDatabase` is four functions against your own tables;
the docs have [ready-to-copy versions](https://authts.dev/docs/database) for
Drizzle and node-postgres.

```ts
// lib/auth.ts
import { createAuth } from "@auth-ts/core"
import { authDatabase } from "./auth-database"

export const auth = createAuth({
  database: authDatabase,
  email: {
    sendCode: async ({ email, code }) => {
      await yourEmailProvider.send({ to: email, text: `Your code is ${code}` })
    }
  }
})
```

Mount it at `/api/auth`, here with TanStack Start:

```ts
// src/routes/api/auth/$.ts
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => auth.handler(request)
    }
  }
})
```

Sign in from the browser:

```ts
import { createAuthClient } from "@auth-ts/core/client"

export const authClient = createAuthClient()

await authClient.sendSignInCode({ email })
await authClient.signInWithCode({ code })
```

Send the token to your API, and verify it there:

```ts
// browser
await fetch("/api/todos", {
  headers: { authorization: `Bearer ${await authClient.getToken()}` }
})

// server
const claims = await auth.verifyToken(token) // null if invalid
```

The [full quickstart](https://authts.dev/docs/quickstart) covers the tables,
other frameworks, and querying Neon with row-level security.

## How it works

The session is a refresh token in an `HttpOnly` cookie. The client trades it for
a short-lived JWT, kept only in memory, which every request carries. Your API or
database verifies the JWT against your public `jwks.json`, with no call back to
auth.ts. See [How it works](https://authts.dev/docs/concepts).

## Development

```text
packages/core                  @auth-ts/core
packages/cli                   @auth-ts/cli
apps/docs                      authts.dev
examples/react/tanstack-start-neon   TanStack Start + Neon example
```

```bash
pnpm install
pnpm test
```

The repo uses pnpm and Nx. `pnpm test` runs every check: `test:lib`,
`test:types`, `test:build`, `build`, sherif and knip. `pnpm run lint` runs Biome.

## Links

- [Documentation](https://authts.dev)
- [Roadmap](ROADMAP.md): what's deferred, and what's deliberately not built

## License

Apache-2.0
