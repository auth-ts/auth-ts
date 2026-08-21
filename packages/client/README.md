# @auth-ts/client

Browser token management for `@auth-ts/server`. Zero runtime dependencies; it
imports the server package for types only.

```bash
bun add @auth-ts/client
```

```ts
import { createAuthClient } from "@auth-ts/client"

export const authClient = createAuthClient()

await authClient.sendCode({ email })
await authClient.verifyCode({ email, code })

// Refreshes only when needed; concurrent callers share one request.
const token = await authClient.getToken()
```

The access token lives in memory and is never persisted. Construction performs no
network request and touches no storage, so importing this module is free and safe
during server-side rendering.

Full documentation: [authts.dev](https://authts.dev)
