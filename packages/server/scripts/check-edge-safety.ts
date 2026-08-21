import { readdirSync, readFileSync, statSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Fails the build if anything Node-only reached the bundle.
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

if (violations.length > 0) {
  console.error(
    "Edge safety check failed — the bundle must not import Node built-ins:"
  )
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log("Edge safety check passed: no Node built-in imports in the bundle.")
