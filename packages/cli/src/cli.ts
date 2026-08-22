import { resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { parseArgs } from "node:util"
import type { JwtAlgorithm } from "./keygen"
import { keygen } from "./keygen"
import { existingEnvNames, writeEnvFile, writeKeySet } from "./write"

const USAGE = `Usage: bun x @auth-ts/cli <command>

Commands:
  keygen [--alg RS256|ES256] [--out DIR] [--env FILE] [--yes]

Prints a signing key, a server secret, and the public key set, then asks
whether to keep them. Nothing is written unless you say so.

  --alg   RS256 (default) or ES256
  --out   where jwks.json goes, default public
  --env   which env file the two variables are appended to, default .env
  --yes   write both without asking. A variable the env file already sets is
          still left alone — replacing a live secret is only ever answered in
          person.

Everything printed goes to stdout and everything said goes to stderr, so the
three lines pipe cleanly on their own.
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

interface KeygenArgs {
  algorithm: JwtAlgorithm
  directory: string
  envPath: string
  yes: boolean
}

function parseKeygenArgs(args: string[]): KeygenArgs {
  let values: { alg: string; out: string; env: string; yes: boolean }
  try {
    values = parseArgs({
      args,
      options: {
        alg: { type: "string", default: "RS256" },
        out: { type: "string", default: "public" },
        env: { type: "string", default: ".env" },
        yes: { type: "boolean", short: "y", default: false }
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
    envPath: resolve(process.cwd(), values.env),
    yes: values.yes
  }
}

/**
 * Asks before writing anything.
 *
 * Only when someone is there to answer: piped or redirected, there is no
 * prompt and nothing is written, so `keygen > keys.txt` cannot hang waiting on
 * a question nobody will see. `--yes` is how a script says write them.
 */
async function confirm(question: string) {
  if (!process.stdin.isTTY) return false

  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr
  })
  try {
    return /^y(es)?$/i.test(
      (await prompt.question(`${question} [y/N] `)).trim()
    )
  } finally {
    prompt.close()
  }
}

async function runKeygen(args: string[]) {
  const options = parseKeygenArgs(args)
  const { privateKeyPem, secret, jwks } = await keygen(options)

  console.log(`JWT_PRIVATE_KEY=${quoteForEnv(privateKeyPem)}`)
  console.log(`AUTH_SECRET="${secret}"`)
  console.log(`JWKS=${JSON.stringify(jwks, null, 2)}`)

  const values = {
    JWT_PRIVATE_KEY: quoteForEnv(privateKeyPem),
    AUTH_SECRET: `"${secret}"`
  }

  const write =
    options.yes ||
    (await confirm(
      `\nWrite ${options.envPath} and ${options.directory}/jwks.json?`
    ))
  if (!write) return

  // Appending is the quiet path. A name already in the file is a live secret,
  // so replacing it is asked about one at a time, and never by a flag.
  const alreadySet = await existingEnvNames(
    options.envPath,
    Object.keys(values)
  )
  const replace: string[] = []
  for (const name of alreadySet) {
    const overwrite = await confirm(
      `${name} is already set in ${options.envPath}. Overwrite it?`
    )
    if (overwrite) replace.push(name)
    else console.error(`Left ${name} as it was.`)
  }

  await writeEnvFile(options.envPath, values, replace)

  // The key set belongs to the key. If the env file kept a private key that is
  // not this one, writing this key set over the old one would publish a
  // verifier for tokens the server is not signing.
  const keptKey =
    alreadySet.includes("JWT_PRIVATE_KEY") &&
    !replace.includes("JWT_PRIVATE_KEY")
  if (keptKey) {
    console.error(
      `Left ${options.directory}/jwks.json alone: it belongs to the key already in ${options.envPath}.`
    )
    return
  }

  const jwksPath = await writeKeySet(options.directory, jwks)

  console.error(`Wrote ${options.envPath} and ${jwksPath}`)
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
