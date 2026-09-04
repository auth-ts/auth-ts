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

/**
 * Colour, only where someone is looking at it.
 *
 * Each stream is styled on its own: piping the values into a file must not put
 * escape codes in it, and that stays true while the questions on stderr are
 * still going to a terminal. `NO_COLOR` turns the lot off.
 *
 * Only the sixteen basic colours, which a terminal remaps to its own theme, so
 * this reads on a light background and a dark one without asking which it is —
 * there is no portable way to ask, and a fixed hex would be wrong half the time.
 */
function styler(stream: { isTTY?: boolean }) {
  const plain = !stream.isTTY || process.env.NO_COLOR
  const paint = (code: number, reset = 39) =>
    plain
      ? (value: string) => value
      : (value: string) => `\u001B[${code}m${value}\u001B[${reset}m`

  return {
    name: paint(36),
    key: paint(35),
    // Never 37: white is one of the two colours a terminal cannot remap safely,
    // so on a light background it is white on white. Values are left at the
    // default foreground, which is readable against whatever is behind it by
    // definition — and they are the part you read, so they should be plainest.
    value: (value: string) => value,
    punctuation: paint(90),
    path: paint(36),
    ok: paint(32),
    warn: paint(33),
    yes: paint(32),
    no: paint(31)
  }
}

type Style = ReturnType<typeof styler>

const out = styler(process.stdout)
const say = styler(process.stderr)

/**
 * JSON, coloured the way an editor would: keys apart from values, punctuation
 * receding. One pass, so a brace inside a string cannot be mistaken for syntax.
 */
function highlightJson(json: string, style: Style) {
  return json.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|([[\]{},])/g,
    (match, key, colon, string, punctuation) => {
      if (key) return `${style.key(key)}${style.punctuation(colon)}`
      if (string) return style.value(string)
      if (punctuation) return style.punctuation(punctuation)
      return match
    }
  )
}

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

  // JWA names them in capitals, but nobody types a header value from memory.
  const algorithm = values.alg.toUpperCase()
  if (!isAlgorithm(algorithm)) {
    return fail(`Unknown algorithm "${values.alg}". Use RS256 or ES256.`)
  }

  return {
    algorithm,
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
    const choices = `${say.punctuation("[")}${say.yes("y")}${say.punctuation("/")}${say.no("N")}${say.punctuation("]")}`
    // End of input — a Ctrl-D at the question — is an answer of no, not a
    // crash on the way out.
    const answer = await prompt
      .question(`${question} ${choices} `)
      .catch(() => "")
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    prompt.close()
  }
}

async function runKeygen(args: string[]) {
  const options = parseKeygenArgs(args)
  const { privateKeyPem, secret, jwks } = await keygen(options)

  const variable = (name: string, value: string) =>
    `${out.name(name)}${out.punctuation("=")}${out.value(value)}\n`

  console.log(variable("JWT_PRIVATE_KEY", quoteForEnv(privateKeyPem)))
  console.log(variable("AUTH_SECRET", `"${secret}"`))
  // Not a variable like the other two — a file, shown as one.
  console.log(
    `${out.name("jwks.json")}\n${highlightJson(JSON.stringify(jwks, null, 2), out)}`
  )

  const values = {
    JWT_PRIVATE_KEY: quoteForEnv(privateKeyPem),
    AUTH_SECRET: `"${secret}"`
  }

  const write =
    options.yes ||
    (await confirm(
      `\nWrite ${say.path(options.envPath)} and ${say.path(`${options.directory}/jwks.json`)}?`
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
    else console.error(say.warn(`Left ${name} as it was.`))
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
      say.warn(
        `Left ${options.directory}/jwks.json alone: it belongs to the key already in ${options.envPath}.`
      )
    )
    return
  }

  const jwksPath = await writeKeySet(options.directory, jwks)

  console.error(
    `${say.ok("Wrote")} ${say.path(options.envPath)} ${say.ok("and")} ${say.path(jwksPath)}`
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
