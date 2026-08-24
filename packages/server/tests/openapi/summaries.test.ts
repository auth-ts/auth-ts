import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { docSummaries } from "../../../../tools/testing/doc-summaries"
import { endpointRegistry } from "../../src/core/endpoint-registry"
import {
  endpointDocs,
  summaries
} from "../../src/openapi/endpoint-docs-registry"

const ENDPOINTS = join(__dirname, "../../src/endpoints")

// Both serve the document, so a docs const in their own file would close an
// import cycle. Their metadata lives in the openapi module instead.
const DECLARED_ELSEWHERE = ["getOpenAPIDocument", "getReference"]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)

    return path.endsWith(".ts") ? [path] : []
  })
}

const documented = Object.assign(
  {},
  ...sourceFiles(ENDPOINTS).map((file) => docSummaries(file))
) as Record<string, string>

describe("openapi summaries", () => {
  it("carries a summary for every registered endpoint", () => {
    expect(Object.keys(summaries).sort()).toEqual(
      Object.keys(endpointRegistry).sort()
    )
  })

  it("carries metadata for every registered endpoint", () => {
    expect(Object.keys(endpointDocs).sort()).toEqual(
      Object.keys(endpointRegistry).sort()
    )
  })

  it("repeats the summary each endpoint already documents", () => {
    const drifted = Object.entries(summaries).filter(
      ([name, summary]) => documented[name] !== summary
    )

    expect(drifted).toEqual([])
  })

  it("keeps summaries plain, since they render where markdown does not", () => {
    // The summary becomes the page title's subtitle, the `<meta>` description,
    // and the sidebar tooltip — all plain text. Emphasis or code spans arrive
    // there as literal asterisks and backticks. The description is markdown;
    // this is not.
    const marked = Object.entries(summaries).filter(([, summary]) =>
      /\*\*|`|\[.*\]\(/.test(summary)
    )

    expect(marked).toEqual([])
  })

  it("declares its metadata beside the endpoint it describes", () => {
    const orphaned = Object.keys(endpointRegistry).filter(
      (name) =>
        !DECLARED_ELSEWHERE.includes(name) && !(`${name}Docs` in documented)
    )

    expect(orphaned).toEqual([])
  })
})
