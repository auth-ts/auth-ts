import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src")

/**
 * Every `.ts` file under `src`.
 *
 * This check reads source text rather than using the TypeScript compiler API,
 * because TypeScript 7's native package no longer ships one — `typescript`
 * exports `version` and nothing else. A structural parse would be nicer; a
 * working check that runs in CI is better than a nicer one that cannot.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)

    return path.endsWith(".ts") ? [path] : []
  })
}

/** Declarations that must carry a doc comment: an exported value or type. */
const EXPORTED_DECLARATION =
  /^export (?:async function|function|const|class|interface|type|abstract class) ([A-Za-z0-9_]+)/

/**
 * Finds exported declarations with no doc comment immediately above them.
 *
 * These comments are not decoration. The documentation site renders API
 * reference tables straight from the source types, so an undocumented export
 * ships as a blank row, and the reasoning that belongs with a security-relevant
 * option would simply not exist anywhere a reader can find it.
 */
function undocumentedExports(filePath: string) {
  const lines = readFileSync(filePath, "utf8").split("\n")
  const undocumented: string[] = []

  for (const [index, line] of lines.entries()) {
    const matched = EXPORTED_DECLARATION.exec(line)
    if (!matched) continue

    const previous = lines[index - 1]?.trim() ?? ""
    if (!previous.endsWith("*/")) undocumented.push(`${matched[1]}`)
  }

  return undocumented
}

describe("public API documentation", () => {
  it("documents every exported declaration in the package", () => {
    const offenders = sourceFiles(sourceRoot)
      .map((filePath) => ({
        file: filePath.slice(sourceRoot.length + 1),
        names: undocumentedExports(filePath)
      }))
      .filter((entry) => entry.names.length > 0)

    expect(offenders).toEqual([])
  })
})
