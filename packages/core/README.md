# @auth-ts/core

Sign-in, sessions and JWTs for any TypeScript app. No framework or database
dependencies, only `jose`, so it runs on Node 20+, Cloudflare Workers, Deno and
Bun.

Browser token management is the same package's `/client` entry, which carries
none of the issuer with it.

```bash
npm install @auth-ts/core
```

```ts
import { createAuth } from "@auth-ts/core"

export const auth = createAuth({
  database: authDatabase, // four functions against your own tables
  email: { sendCode: async ({ email, code }) => {} }
})
```

You get the same endpoints three ways, derived from one registry so they cannot
disagree: callable directly from your backend (`auth.getToken({ headers })`),
as one catch-all handler (`auth.handler`), or as individual handlers
(`auth.handlers.sendSignInCode`).

Check your own four functions against the contract — point it at the database
you actually use, since each check cleans up after itself:

```ts
import { authDatabaseChecks } from "@auth-ts/core/testing"

for (const check of authDatabaseChecks) {
  it(check.name, () => check.run(authDatabase))
}
```

`createMemoryDatabase` is exported from the same entry, for testing the code above
`AuthDatabase` rather than `AuthDatabase` itself.

Full documentation: [authts.dev](https://authts.dev)
