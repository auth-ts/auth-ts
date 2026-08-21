import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createAuthServer } from "@auth-ts/server"

/**
 * Writes the public JWKS to `jwks.json` and prints it.
 *
 * Neon and Supabase fetch the key set over the public internet, which localhost
 * is not. For local development, host this somewhere reachable — a GitHub gist
 * works — and point the JWKS URL at that. Only public key material is emitted;
 * the private key never leaves your environment.
 *
 * It is a **copy**, so it goes stale the moment you rotate or regenerate keys.
 * In a real deployment, point the verifier at the live endpoint
 * (`<baseURL>/api/auth/jwks.json`) instead, so rotation needs no second step.
 *
 * Run with: bun run jwks
 */
const authServer = createAuthServer({
  // Only the key material matters here, so the callbacks are never reached.
  db: {} as never,
  email: { sendCode: () => {} }
})

const jwks = await authServer.getJwks(undefined as never)
const serialized = `${JSON.stringify(jwks, null, 2)}\n`
const outputPath = resolve(import.meta.dirname, "../jwks.json")

writeFileSync(outputPath, serialized)

console.log(serialized)
console.log(`Written to ${outputPath}`)
console.log(
  "Host it publicly (a gist works), then set that URL as the JWKS URL in Neon."
)
console.log("It is a snapshot: regenerate it whenever the signing key changes.")
