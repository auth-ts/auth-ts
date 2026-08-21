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

const NODE_IMPORT =
  /(?:^|\s)(?:import|export)[^;]*?from\s*["'](node:[^"']+)["']/gm
const NODE_REQUIRE = /require\(\s*["'](node:[^"']+)["']\s*\)/g

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

  for (const pattern of [NODE_IMPORT, NODE_REQUIRE]) {
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
