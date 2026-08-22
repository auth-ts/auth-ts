# @auth-ts/server

The issuer. Zero framework dependencies, zero database dependencies — `jose` and
nothing else — so it runs on Node 20+, Cloudflare Workers, Deno, and Bun alike.

```bash
bun add @auth-ts/server
```

```ts
import { createAuthServer } from "@auth-ts/server"

export const authServer = createAuthServer({
  db: {
    /* the eighteen callbacks, written against your own tables */
  },
  email: { sendCode: async ({ email, code }) => {} }
})
```

You get the same endpoints three ways, derived from one registry so they cannot
disagree: callable directly from your backend (`authServer.getToken({ headers })`),
as one catch-all handler (`authServer.handler`), or as individual handlers
(`authServer.handlers.sendCode`).

Test your own callbacks against the same in-memory implementation this library's
test suite runs on:

```ts
import { createMemoryDb } from "@auth-ts/server/testing"
```

Full documentation: [authts.dev](https://authts.dev)
