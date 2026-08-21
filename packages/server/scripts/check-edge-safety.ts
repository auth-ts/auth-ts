import { readdirSync, readFileSync, statSync } from "node:fs"
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

/** `import x from "node:fs"`, and the `export ... from` form. */
const NODE_IMPORT_FROM =
  /(?:^|\s)(?:import|export)[^;]*?from\s*["'](node:[^"']+)["']/gm
/** `import "node:fs"` — no bindings, so no `from` for the pattern above to find. */
const NODE_SIDE_EFFECT_IMPORT = /(?:^|\s)import\s*["'](node:[^"']+)["']/gm
/** `import("node:fs")` — evaluated at runtime, so just as fatal on an edge runtime. */
const NODE_DYNAMIC_IMPORT = /\bimport\(\s*["'](node:[^"']+)["']\s*\)/g
/** `require("node:fs")` in any CommonJS output. */
const NODE_REQUIRE = /require\(\s*["'](node:[^"']+)["']\s*\)/g

const NODE_REFERENCE_PATTERNS = [
  NODE_IMPORT_FROM,
  NODE_SIDE_EFFECT_IMPORT,
  NODE_DYNAMIC_IMPORT,
  NODE_REQUIRE
]

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

  for (const pattern of NODE_REFERENCE_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of contents.matchAll(pattern)) {
      violations.push(
        `${filePath.slice(distributionRoot.length + 1)} imports ${match[1]}`
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

console.log("Edge safety check passed: no node: imports in the bundle.")
