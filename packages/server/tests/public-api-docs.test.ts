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

/**
 * Slices the block a check should scan, refusing to guess when a marker moved.
 *
 * `indexOf` answers -1 for text that has been renamed, and `slice(-1)` quietly
 * returns the final character — a scan over nothing, which passes. These checks
 * exist to fail when documentation is missing, so a sentinel that no longer
 * matches has to be louder than the thing it was guarding. The end marker is
 * searched from `start` so a coincidental earlier match cannot produce an empty
 * block either.
 */
function sliceBetweenMarkers(
  source: string,
  startMarker: string,
  endMarker?: string
) {
  const start = source.indexOf(startMarker)
  if (start === -1) {
    throw new Error(`Marker no longer present in source: ${startMarker}`)
  }
  if (endMarker === undefined) return source.slice(start)

  const end = source.indexOf(endMarker, start)
  if (end === -1) {
    throw new Error(`Marker no longer present in source: ${endMarker}`)
  }

  return source.slice(start, end)
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

  it("documents every field of the database contract, which consumers implement by hand", () => {
    const source = readFileSync(join(sourceRoot, "core/auth-db.ts"), "utf8")
    const contract = sliceBetweenMarkers(source, "export interface AuthDb {")
    const lines = contract.split("\n")

    const undocumented: string[] = []
    for (const [index, line] of lines.entries()) {
      const matched = /^ {2}([a-zA-Z]+)\(/.exec(line)
      if (!matched) continue

      const previous = lines[index - 1]?.trim() ?? ""
      if (!previous.endsWith("*/")) undocumented.push(matched[1] as string)
    }

    expect(undocumented).toEqual([])
  })

  it("documents every option field, since defaults are part of the contract", () => {
    const source = readFileSync(
      join(sourceRoot, "core/auth-server-options.ts"),
      "utf8"
    )
    const optionsBlock = sliceBetweenMarkers(
      source,
      "export interface AuthServerOptions {",
      "/** Options after defaults"
    )
    const lines = optionsBlock.split("\n")

    const undocumented: string[] = []
    for (const [index, line] of lines.entries()) {
      const matched = /^ {2}([a-zA-Z]+)\??:/.exec(line)
      if (!matched) continue

      const previous = lines[index - 1]?.trim() ?? ""
      if (!previous.endsWith("*/")) undocumented.push(matched[1] as string)
    }

    expect(undocumented).toEqual([])
  })

  it("fails loudly when a sentinel is renamed, instead of scanning nothing", () => {
    const source = "export interface AuthDb {\n  getUser(): void\n}\n"

    // Without the guard this returns "\n" and every check below it passes.
    expect(() =>
      sliceBetweenMarkers(source, "export interface Renamed {")
    ).toThrow(/Renamed/)
    expect(() =>
      sliceBetweenMarkers(source, "export interface AuthDb {", "/** reworded")
    ).toThrow(/reworded/)

    // And the happy path still returns the block it was asked for.
    expect(sliceBetweenMarkers(source, "export interface AuthDb {")).toContain(
      "getUser"
    )
    expect(
      sliceBetweenMarkers(source, "export interface AuthDb {", "  getUser")
    ).toBe("export interface AuthDb {\n")
  })
})
