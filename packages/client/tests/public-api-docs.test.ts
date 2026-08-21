import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  sourceFiles,
  undocumentedExports
} from "../../../tools/testing/undocumented-exports.ts"

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src")

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
