import { readFileSync } from "node:fs"

/**
 * Extracts the first line of each exported declaration's doc comment.
 *
 * Lives beside the gate that requires those comments to exist, and reads source
 * text the same way: TypeScript 7 ships no compiler API, so a regex over raw
 * lines is what there is. Used to hold an operation's OpenAPI summary to the
 * summary its endpoint already carries, rather than letting the two be written
 * twice and drift.
 */
export function docSummaries(filePath: string) {
  return docSummariesInSource(readFileSync(filePath, "utf8"))
}

const EXPORTED_DECLARATION =
  /^\s*export (?:declare )?(?:abstract )?(?:async )?(?:function\*?|const|let|var|enum|class|interface|type) ([A-Za-z0-9_$]+)/

/**
 * Where the doc comment above `index` opens, or null if there is none.
 *
 * Deliberately the same walk the presence gate does — a doc comment opens with
 * `/**` and nothing else — returning the cursor instead of discarding it.
 */
function docCommentStart(lines: string[], index: number) {
  if (!(lines[index - 1]?.trim() ?? "").endsWith("*/")) return null

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = lines[cursor]?.trim() ?? ""
    if (candidate.startsWith("/**"))
      return candidate.startsWith("/**/") ? null : cursor
    if (candidate.startsWith("/*")) return null
    if (candidate.startsWith("*") || candidate.endsWith("*/")) continue
    return null
  }

  return null
}

/** The extraction behind {@link docSummaries}, on source text. */
export function docSummariesInSource(source: string) {
  const lines = source.split("\n")
  const summaries: Record<string, string> = {}

  for (const [index, line] of lines.entries()) {
    const name = EXPORTED_DECLARATION.exec(line)?.[1]
    if (name === undefined) continue

    const start = docCommentStart(lines, index)
    if (start === null) continue

    const body: string[] = []
    for (const raw of lines.slice(start, index)) {
      const text = raw
        .trim()
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .replace(/^\*/, "")
        .trim()

      // A blank line closes the summary; every block here opens with one
      // sentence, then a blank, then the body.
      if (text.length === 0 && body.length > 0) break
      if (text.startsWith("@")) break
      if (text.length > 0) body.push(text)
    }

    if (body.length > 0) summaries[name] = body.join(" ")
  }

  return summaries
}
