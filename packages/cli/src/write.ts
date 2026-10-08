import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Jwks } from "./keygen"

const ENV_ASSIGNMENT =
  /^([^\S\r\n]*(?:export[^\S\r\n]+)?([\w.-]+)[^\S\r\n]*=[^\S\r\n]*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\r\n]*)[^\r\n]*/gm

async function readExistingFile(path: string) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw error
  }
}

/** Writes the key set, creating the directory if it is not there. */
export async function writeKeySet(directory: string, jwks: Jwks) {
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, "jwks.json")
  await writeFile(path, `${JSON.stringify(jwks, null, 2)}\n`)

  return path
}

/** Finds assigned names without returning their values. */
export async function existingEnvNames(path: string, names: string[]) {
  const contents = await readExistingFile(path)
  const assigned = new Set(
    [...contents.matchAll(ENV_ASSIGNMENT)].map((match) => match[2])
  )

  return names.filter((name) => assigned.has(name))
}

/** Replaces named assignments only when explicitly authorized. */
export async function writeEnvFile(
  path: string,
  values: Record<string, string>,
  replace: string[] = []
) {
  let contents = await readExistingFile(path)

  for (const [name, value] of Object.entries(values)) {
    const matches = [...contents.matchAll(ENV_ASSIGNMENT)].filter(
      (match) => match[2] === name
    )

    if (matches.length > 0) {
      if (replace.includes(name)) {
        for (const match of matches.reverse()) {
          contents =
            contents.slice(0, match.index) +
            `${match[1]}${value}` +
            contents.slice(match.index + match[0].length)
        }
      }
      continue
    }

    const separator = contents && !contents.endsWith("\n") ? "\n" : ""
    contents = `${contents}${separator}${name}=${value}\n`
  }

  await writeFile(path, contents)
  return path
}
