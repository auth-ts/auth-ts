import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { codeMask } from "../../../tools/build/code-mask"

/**
 * Fails the build if anything Node-only reached the bundle, or if the browser
 * entry reached anything server-side.
 *
 * The package targets edge runtimes as well as Node, which is a promise that is
 * easy to break by accident: a single `node:crypto` import somewhere deep in a
 * helper would still pass every test on Node and only fail once someone deployed
 * to Cloudflare Workers. This turns that into a build error instead.
 *
 * Only import statements count — the source comments explaining *why* there is
 * no `node:crypto` fallback are not violations.
 */
const distributionRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist"
)

// Every specifier is captured, not just `node:`-prefixed ones, because the bare
// form is a Node built-in too: `import x from "fs"` breaks an edge deploy in
// exactly the same way. isNodeBuiltin decides which captures count, so these
// patterns stay simple and ordinary package imports fall out there.

/** `import x from "fs"`, and the `export ... from` form. */
const IMPORT_FROM = /(?:^|\s)(?:import|export)[^;]*?from\s*["']([^"']+)["']/gm
/** `import "fs"` — no bindings, so no `from` for the pattern above to find. */
const SIDE_EFFECT_IMPORT = /(?:^|\s)import\s*["']([^"']+)["']/gm
/** `import("fs")` — evaluated at runtime, so just as fatal on an edge runtime. */
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g
/** `require("fs")` in any CommonJS output. */
const REQUIRE = /require\(\s*["']([^"']+)["']\s*\)/g

const IMPORT_PATTERNS = [
  IMPORT_FROM,
  SIDE_EFFECT_IMPORT,
  DYNAMIC_IMPORT,
  REQUIRE
]

const BUILTIN_MODULES = new Set(builtinModules)

/**
 * Whether an import specifier resolves to a Node built-in.
 *
 * A `node:` prefix settles it on its own: the prefix means exactly that, and
 * relying on it covers the built-ins `builtinModules` leaves out because they
 * are reachable only when prefixed — `node:test` and `node:sqlite` among them.
 *
 * A bare specifier has to be looked up instead, which is what keeps ordinary
 * dependencies out of the report: `fs` is in the list, `fastify` is not. A
 * package that shares a built-in's name resolves to the built-in anyway, so
 * flagging it is right rather than a false positive.
 */
function isNodeBuiltin(specifier: string) {
  return specifier.startsWith("node:") || BUILTIN_MODULES.has(specifier)
}

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return javascriptFiles(path)

    return path.endsWith(".js") ? [path] : []
  })
}

const violations: string[] = []

for (const filePath of javascriptFiles(distributionRoot)) {
  const contents = readFileSync(filePath, "utf8")

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of contents.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier === undefined || !isNodeBuiltin(specifier)) continue

      violations.push(
        `${filePath.slice(distributionRoot.length + 1)} imports ${specifier}`
      )
    }
  }
}

/**
 * Rolldown labels each inlined module with the source it came from.
 *
 * This is the only provenance the output carries, and it survives because the
 * build sets `minify: false`.
 */
const REGION = /^\/\/#region (.+)$/gm

/**
 * A module every build must report, so a format change fails here.
 *
 * If rolldown stops writing these banners the scan below finds nothing and
 * passes, which is the one way this check can be wrong without anyone noticing.
 */
const PROVENANCE_SENTINEL = "src/core/create-auth.ts"

interface EntryRule {
  entry: string
  /** Source prefixes this entry may be built from; `null` allows any. */
  sources: string[] | null
  /** Source prefixes this entry must never be built from. */
  forbidden: string[]
  /** Bare specifiers this entry may ask a consumer to resolve. */
  dependencies: string[]
}

const ENTRY_RULES: EntryRule[] = [
  {
    entry: "client.js",
    sources: ["src/client.ts", "src/client/", "src/shared/"],
    forbidden: [],
    dependencies: []
  },
  {
    entry: "index.js",
    sources: null,
    forbidden: ["src/client.ts", "src/client/"],
    dependencies: ["jose"]
  },
  {
    entry: "testing.js",
    sources: null,
    forbidden: ["src/client.ts", "src/client/"],
    dependencies: []
  }
]

function specifiersIn(contents: string) {
  // The bundle keeps its source comments, and a doc comment's example import is
  // prose rather than an edge this walk should follow.
  const isCode = codeMask(contents)
  const found: string[] = []

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of contents.matchAll(pattern)) {
      if (match[1] === undefined || isCode[match.index] !== 1) continue
      found.push(match[1])
    }
  }

  return found
}

/** Every dist file an entry pulls in, and every package it leaves to the consumer. */
function reachableFrom(entry: string) {
  const files = new Set<string>()
  const dependencies = new Set<string>()
  const queue = [resolve(distributionRoot, entry)]

  while (queue.length > 0) {
    const filePath = queue.pop() as string
    if (files.has(filePath)) continue
    files.add(filePath)

    for (const specifier of specifiersIn(readFileSync(filePath, "utf8"))) {
      if (!specifier.startsWith(".")) {
        dependencies.add(specifier)
        continue
      }

      // The bundle keeps its source comments, and those contain example
      // imports. Only a specifier that names a file the bundler emitted is a
      // real edge.
      const target = resolve(dirname(filePath), specifier)
      if (existsSync(target)) queue.push(target)
    }
  }

  return { files: [...files], dependencies: [...dependencies] }
}

/** The sources a set of bundled files was built from. */
function regionsIn(files: string[]) {
  const regions = new Set<string>()
  for (const filePath of files) {
    const contents = readFileSync(filePath, "utf8")
    REGION.lastIndex = 0
    for (const match of contents.matchAll(REGION)) {
      if (match[1] !== undefined) regions.add(match[1])
    }
  }

  return regions
}

let sentinelSeen = false

for (const rule of ENTRY_RULES) {
  const { files, dependencies } = reachableFrom(rule.entry)
  const regions = regionsIn(files)
  if (regions.has(PROVENANCE_SENTINEL)) sentinelSeen = true

  for (const region of regions) {
    if (
      rule.sources &&
      !rule.sources.some((allowed) => region.startsWith(allowed))
    ) {
      violations.push(
        `${rule.entry} reaches ${region} (allowed: ${rule.sources.join(", ")})`
      )
    }
    if (rule.forbidden.some((denied) => region.startsWith(denied))) {
      violations.push(`${rule.entry} reaches ${region}, which is browser-only`)
    }
  }

  for (const dependency of dependencies) {
    if (!rule.dependencies.includes(dependency)) {
      violations.push(`${rule.entry} imports ${dependency} at runtime`)
    }
  }
}

if (!sentinelSeen) {
  violations.push(
    `no bundle reported ${PROVENANCE_SENTINEL} — the //#region banners this check reads are gone`
  )
}

if (violations.length > 0) {
  console.error("Bundle check failed:")
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(
  "Bundle check passed: no Node built-ins, and the entries stay apart."
)
