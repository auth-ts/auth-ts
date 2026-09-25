import { authClient } from "../auth-client"

declare const email: string
declare const code: string
// ---cut---
await authClient.sendSignInCode({ email })
await authClient.signInWithCode({ code })

const token = await authClient.getToken()
