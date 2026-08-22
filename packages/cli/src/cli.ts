import { resolve } from "node:path"
import { parseArgs } from "node:util"
import type { JwtAlgorithm, KeygenOptions } from "./keygen"
import { keygen } from "./keygen"

const USAGE = `Usage: bun x @auth-ts/cli <command>

Commands:
  keygen [--alg RS256|ES256] [--out DIR]
                              Generate a signing key and server secret, and
                              write the public key set to DIR/jwks.json.
                              DIR defaults to the working directory; pass
                              --out public where your framework serves it.
                              --dry writes nothing and prints the key set
                              alongside the two .env lines.

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

function parseKeygenArgs(args: string[]): KeygenOptions {
  let values: { alg: string; out: string; dry: boolean }
  try {
    values = parseArgs({
      args,
      options: {
        alg: { type: "string", default: "RS256" },
        out: { type: "string", default: "." },
        dry: { type: "boolean", default: false }
      },
      allowPositionals: false
    }).values
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  if (!isAlgorithm(values.alg)) {
    return fail(`Unknown algorithm "${values.alg}". Use RS256 or ES256.`)
  }

  return {
    algorithm: values.alg,
    directory: resolve(process.cwd(), values.out),
    dry: values.dry
  }
}

async function runKeygen(args: string[]) {
  const options = parseKeygenArgs(args)
  const result = await keygen(options)

  console.log(`JWT_PRIVATE_KEY=${quoteForEnv(result.privateKeyPem)}`)
  console.log(`AUTH_SECRET="${result.secret}"`)

  if (options.dry) {
    console.log(`JWKS=${JSON.stringify(result.jwks, null, 2)}`)
    return
  }

  console.error(`Wrote ${result.jwksPath}`)
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
