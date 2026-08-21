import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The documentation gate, shared by every package that publishes an API.
 *
 * It lives outside `packages/` on purpose: `nx.json` releases `packages/*`, so
 * a test utility placed there would join the publish set. It is depended on by
 * `sharedGlobals` in `nx.json`, without which a change here would leave both
 * packages' cached `test` results standing and the weakened gate would go
 * unnoticed — the exact failure the shared module exists to prevent.
 */

/**
 * Every `.ts` file under `src`.
 *
 * This check reads source text rather than using the TypeScript compiler API,
 * because TypeScript 7's native package no longer ships one — `typescript`
 * exports `version` and nothing else. A structural parse would be nicer; a
 * working check that runs in CI is better than a nicer one that cannot.
 */
export function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)

    return path.endsWith(".ts") ? [path] : []
  })
}

/**
 * Declarations that must carry a doc comment: an exported value or type.
 *
 * The alternation is deliberately wide. This gate is only as strong as the
 * syntax it recognises, so any form it misses is an export that ships
 * undocumented because of how it was written rather than because someone
 * decided it needed no comment. Modifiers are matched as an optional chain
 * rather than spelled out per keyword, so `declare`, `abstract`, generators
 * and their combinations cannot slip through either.
 *
 * The name is required, which is what keeps re-export lines — `export {` and
 * `export type {` — out of the check. An anonymous `export default` has no
 * name to require, so it is matched separately below.
 */
const EXPORTED_DECLARATION =
  /^export (?:declare )?(?:default )?(?:abstract )?(?:async )?(?:function\*?|const|let|var|enum|class|interface|type) ([A-Za-z0-9_$]+)/

/** Any remaining default export, which may be anonymous and so unnamed. */
const DEFAULT_EXPORT = /^export default(?: |$)/

/**
 * Whether the comment block ending on the line above `index` is a doc comment.
 *
 * A doc comment opens with `/**`, and only that — a plain `/* note *\/` above an
 * export is not documentation, and the gate would be weaker than it looks if
 * it counted one. The opener is found by walking up from the closing `*\/`:
 * the line above an export is just ` *\/` for a multi-line comment, so the
 * closing line alone cannot tell the two apart. Body lines start with `*`, so
 * the first line that *opens* a comment decides; a `/*` inside a body line is
 * text, not an opener.
 */
function hasDocComment(lines: string[], index: number) {
  if (!(lines[index - 1]?.trim() ?? "").endsWith("*/")) return false

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = lines[cursor]?.trim() ?? ""
    // `/**\/` is an empty block comment, not a doc comment with nothing in it.
    if (candidate.startsWith("/**")) return !candidate.startsWith("/**/")
    if (candidate.startsWith("/*")) return false
    // Still inside the block; keep walking up to its opener.
    if (candidate.startsWith("*") || candidate.endsWith("*/")) continue
    return false
  }

  return false
}

/**
 * Finds exported declarations with no doc comment immediately above them.
 *
 * These comments are not decoration. The documentation site renders API
 * reference tables straight from the source types, so an undocumented export
 * ships as a blank row, and the reasoning that belongs with a security-relevant
 * option would simply not exist anywhere a reader can find it.
 */
export function undocumentedExports(filePath: string) {
  return undocumentedExportsInSource(readFileSync(filePath, "utf8"))
}

/** The check behind {@link undocumentedExports}, on source text — so the gate itself can be tested. */
export function undocumentedExportsInSource(source: string) {
  const lines = source.split("\n")
  const undocumented: string[] = []

  for (const [index, line] of lines.entries()) {
    const matched = EXPORTED_DECLARATION.exec(line)
    const name = matched?.[1] ?? (DEFAULT_EXPORT.test(line) ? "default" : null)
    if (name === null) continue

    if (!hasDocComment(lines, index)) undocumented.push(name)
  }

  return undocumented
}
