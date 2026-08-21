import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"

/**
 * Prints a fresh signing key pair for `.env`.
 *
 * The private key signs tokens; the public half is derived from it at runtime and
 * served from the JWKS endpoint, so only the private key belongs in the
 * environment. Run with `bun run keys`.
 */
const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true
})

const privateKeyPem = await exportPKCS8(privateKey)
const publicKeyPem = await exportSPKI(publicKey)

console.log(
  "# Add to .env — the private key must be quoted, it contains newlines.\n"
)
console.log(
  `JWT_PRIVATE_KEY="${privateKeyPem.trimEnd().replace(/\n/g, "\\n")}"`
)
console.log(`AUTH_SECRET="${crypto.randomUUID()}${crypto.randomUUID()}"`)
console.log(
  "\n# The public half, for reference. Not needed in the environment."
)
console.log(`# ${publicKeyPem.trimEnd().replace(/\n/g, " ")}`)
