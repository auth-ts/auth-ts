import { parseArgs } from "node:util"
import type { JwtAlgorithm } from "./keygen"
import { keygen } from "./keygen"

const USAGE = `Usage: bun x @auth-ts/cli <command>

Commands:
  keygen [--alg RS256|ES256]  Generate a signing key and server secret, and
                              write the public key set to public/jwks.json

The .env lines go to stdout and everything else to stderr, so they pipe
cleanly if you want them somewhere other than your clipboard.
`

const ALGORITHMS: readonly JwtAlgorithm[] = ["RS256", "ES256"]

function isAlgorithm(value: string): value is JwtAlgorithm {
  return ALGORITHMS.some((candidate) => candidate === value)
}

/**
 * A PEM as a double-quoted `.env` value.
 *
 * The line breaks become literal `\n`: dotenv, Bun, and Vite all expand those
 * inside double quotes, and a multi-line value would break most other loaders.
 */
function quoteForEnv(pem: string) {
  return `"${pem.trimEnd().replace(/\n/g, "\\n")}"`
}

function fail(message: string): never {
  console.error(`${message}\n`)
  console.error(USAGE)
  process.exit(1)
}

function parseKeygenArgs(args: string[]): JwtAlgorithm {
  let algorithm: string
  try {
    algorithm = parseArgs({
      args,
      options: { alg: { type: "string", default: "RS256" } },
      allowPositionals: false
    }).values.alg
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  return isAlgorithm(algorithm)
    ? algorithm
    : fail(`Unknown algorithm "${algorithm}". Use RS256 or ES256.`)
}

async function runKeygen(args: string[]) {
  const result = await keygen({
    algorithm: parseKeygenArgs(args),
    directory: process.cwd()
  })

  console.log(`JWT_PRIVATE_KEY=${quoteForEnv(result.privateKeyPem)}`)
  console.log(`AUTH_SECRET="${result.secret}"`)

  console.error(
    [
      "",
      "Copy the two lines above into your .env.",
      "",
      `Wrote ${result.jwksPath} — the public key, safe to publish.`,
      "Deployed, it is served at <origin>/jwks.json: point Neon there. To rotate,",
      "run this again and deploy the new key and the new file together."
    ].join("\n")
  )
}

const [command, ...rest] = process.argv.slice(2)

switch (command) {
  case "keygen":
    await runKeygen(rest)
    break
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE)
    break
  default:
    fail(`Unknown command "${command}".`)
}
