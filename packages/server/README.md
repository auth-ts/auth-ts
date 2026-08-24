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
    /* select, insert, update, delete — written against your own tables */
  },
  email: { sendCode: async ({ email, code }) => {} }
})
```

You get the same endpoints three ways, derived from one registry so they cannot
disagree: callable directly from your backend (`authServer.getToken({ headers })`),
as one catch-all handler (`authServer.handler`), or as individual handlers
(`authServer.handlers.sendSignInCode`).

Check your own four functions against the contract — point it at the database
you actually use, since each check cleans up after itself:

```ts
import { authDBChecks } from "@auth-ts/server/testing"

for (const check of authDBChecks) {
  it(check.name, () => check.run(authDB))
}
```

`createMemoryDb` is exported from the same entry, for testing the code above
`AuthDB` rather than `AuthDB` itself.

Full documentation: [authts.dev](https://authts.dev)
