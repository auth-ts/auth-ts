import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

/**
 * Gives every relative specifier in the emitted declarations a real extension.
 *
 * Source imports are written plainly — `from "./sign-token"` — because an
 * extension that names a `.ts` file is noise in code a human reads, and the
 * bundler resolves it without help. Declarations are not read by the bundler
 * though. They are read by *other people's* compilers, and a consumer on
 * `"moduleResolution": "node16"` or `"nodenext"` follows Node's ESM rules, where
 * a relative specifier without an extension does not resolve at all. Shipping
 * `from "./sign-token"` in a `.d.ts` fails those consumers with TS2834 on every
 * line of the public API, so the extension is added on the way out instead of
 * being carried through the source.
 *
 * This replaces TypeScript's `rewriteRelativeImportExtensions`, which buys the
 * same correct output at the price of `.ts` extensions written throughout the
 * source. The rewrite happens once, here, on generated files nobody edits.
 *
 * Each specifier is resolved against what was actually emitted rather than
 * having `.js` pasted onto it, so a path that resolves to nothing fails the
 * build. That is the part worth keeping: the check that a published type import
 * points at a file that exists is exactly the check a `nodenext` consumer runs,
 * and running it here means finding out at build time instead of from an issue.
 */

/** `import x from "./y"`, and the `export ... from` form. */
const IMPORT_FROM =
  /((?:^|\s)(?:import|export)[^;]*?from\s*["'])([^"']+)(["'])/gm
/** `import "./y"` — no bindings, so no `from` for the pattern above to find. */
const SIDE_EFFECT_IMPORT = /((?:^|\s)import\s*["'])([^"']+)(["'])/gm
/** `import("./y")` — how TypeScript writes a type it had to reach for inline. */
const DYNAMIC_IMPORT = /(\bimport\(\s*["'])([^"']+)(["']\s*\))/g

const SPECIFIER_PATTERNS = [IMPORT_FROM, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]

function declarationFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return declarationFiles(path)

    return path.endsWith(".d.ts") ? [path] : []
  })
}

/**
 * The runtime specifier for a relative import, or null if nothing matches it.
 *
 * Both shapes TypeScript can emit are tried, in the order Node resolves them: a
 * sibling module, then a directory's index. The `.js` that comes back is the
 * name of the *runtime* file the declaration describes — `sign-token.d.ts`
 * types `sign-token.js` — which is what a consumer's compiler is looking for.
 */
function resolveSpecifier(fromFile: string, specifier: string) {
  const target = resolve(dirname(fromFile), specifier)

  if (statSync(`${target}.d.ts`, { throwIfNoEntry: false })?.isFile())
    return `${specifier}.js`

  if (statSync(join(target, "index.d.ts"), { throwIfNoEntry: false })?.isFile())
    return `${specifier}/index.js`

  return null
}

const distributionRoot = resolve(process.argv[2] ?? "")
if (process.argv[2] === undefined) {
  console.error("Usage: dts-extensions.ts <dist directory>")
  process.exit(1)
}

const unresolved: string[] = []
let rewritten = 0

for (const filePath of declarationFiles(distributionRoot)) {
  const contents = readFileSync(filePath, "utf8")
  let updated = contents

  for (const pattern of SPECIFIER_PATTERNS) {
    updated = updated.replace(
      pattern,
      (match, lead: string, specifier: string, close: string) => {
        // Only relative specifiers are ours to fix. A bare `jose` is the
        // consumer's own resolution problem, and an extension is already right.
        if (!specifier.startsWith(".")) return match
        if (/\.(js|mjs|cjs|json)$/.test(specifier)) return match

        const resolved = resolveSpecifier(filePath, specifier)
        if (resolved === null) {
          unresolved.push(
            `${relative(distributionRoot, filePath)} imports ${specifier}`
          )
          return match
        }

        rewritten++
        return `${lead}${resolved}${close}`
      }
    )
  }

  if (updated !== contents) writeFileSync(filePath, updated)
}

if (unresolved.length > 0) {
  console.error(
    "Declaration extension pass failed — these imports resolve to nothing:"
  )
  for (const violation of unresolved) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(
  `Declaration extensions added: ${rewritten} imports in ${relative(process.cwd(), distributionRoot)}.`
)
