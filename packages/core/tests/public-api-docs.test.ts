import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  sourceFiles,
  undocumentedExports,
  undocumentedExportsInSource
} from "../../../tools/testing/undocumented-exports"

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src")

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
    const source = readFileSync(
      join(sourceRoot, "core/auth-database.ts"),
      "utf8"
    )
    // Stop at `defineAuthDatabase`: its implementation object restates the same four
    // functions, documented once above rather than again on each line.
    const contract = sliceBetweenMarkers(
      source,
      "export interface AuthDatabase<",
      "export function defineAuthDatabase<"
    )
    const lines = contract.split("\n")

    const undocumented: string[] = []
    for (const [index, line] of lines.entries()) {
      // Every member is a method, and each may be generic (`select<T…>(`),
      // optional, or phantom (`__schema?(`) — none of which exempts it from
      // carrying a doc comment.
      const matched = /^ {2}(__)?([a-zA-Z]+)\??(<[^>]*>)?\(/.exec(line)
      if (!matched) continue

      const previous = lines[index - 1]?.trim() ?? ""
      if (!previous.endsWith("*/")) {
        undocumented.push(`${matched[1] ?? ""}${matched[2]}`)
      }
    }

    expect(undocumented).toEqual([])
  })

  it("documents every option field, since defaults are part of the contract", () => {
    const source = readFileSync(
      join(sourceRoot, "core/auth-options.ts"),
      "utf8"
    )
    // The options interface is the last declaration in its file — the resolver
    // and the resulting `AuthConfig` live in auth-config.ts.
    const optionsBlock = sliceBetweenMarkers(
      source,
      "export interface AuthOptions<"
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

  it("accepts only a doc comment, not any comment, above an export", () => {
    // Each of these used to pass because the line above ended with `*/`.
    expect(
      undocumentedExportsInSource(
        [
          "/* temporary note */",
          "export const plainBlock = 1",
          "/*",
          " * Looks like a doc comment from the closing line alone.",
          " */",
          "export const multiLinePlainBlock = 2",
          "/**/",
          "export const emptyBlock = 3",
          "// line comment",
          "export const lineComment = 4",
          "export const nothing = 5",
          'declare module "augmented" {',
          "  export interface IndentedNothing {}",
          "}"
        ].join("\n")
      )
    ).toEqual([
      "plainBlock",
      "multiLinePlainBlock",
      "emptyBlock",
      "lineComment",
      "nothing",
      "IndentedNothing"
    ])

    // And every real doc-comment shape still counts, including a body line that
    // happens to contain `/*`, which must not be mistaken for the opener.
    expect(
      undocumentedExportsInSource(
        [
          "/** One line. */",
          "export const oneLine = 1",
          "/**",
          " * Several lines.",
          " *",
          " * Mount once at `<basePath>/*` and it dispatches.",
          " */",
          "export function multiLine() {}",
          'declare module "augmented" {',
          "  /** Indented, inside a declare-module or namespace block. */",
          "  export type Indented = string",
          "}"
        ].join("\n")
      )
    ).toEqual([])
  })

  it("fails loudly when a sentinel is renamed, instead of scanning nothing", () => {
    const source = "export interface AuthDatabase {\n  getUser(): void\n}\n"

    // Without the guard this returns "\n" and every check below it passes.
    expect(() =>
      sliceBetweenMarkers(source, "export interface Renamed {")
    ).toThrow(/Renamed/)
    expect(() =>
      sliceBetweenMarkers(
        source,
        "export interface AuthDatabase {",
        "/** reworded"
      )
    ).toThrow(/reworded/)

    // And the happy path still returns the block it was asked for.
    expect(
      sliceBetweenMarkers(source, "export interface AuthDatabase {")
    ).toContain("getUser")
    expect(
      sliceBetweenMarkers(
        source,
        "export interface AuthDatabase {",
        "  getUser"
      )
    ).toBe("export interface AuthDatabase {\n")
  })
})
