import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Jwks } from "./keygen"

/** Writes the key set, creating the directory if it is not there. */
export async function writeKeySet(directory: string, jwks: Jwks) {
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, "jwks.json")
  await writeFile(path, `${JSON.stringify(jwks, null, 2)}\n`)

  return path
}

/** The variables an env file already sets, of the ones given. */
export async function existingEnvNames(path: string, names: string[]) {
  const contents = await readFile(path, "utf8").catch(() => "")

  return names.filter((name) => new RegExp(`^${name}=`, "m").test(contents))
}

/**
 * Appends variables to an env file, replacing only the ones named in `replace`.
 *
 * Append-only by default: a value already in the file is a live secret, and
 * overwriting it invalidates everything signed with it. Replacing is possible
 * but never assumed — the caller asks first, and passes the answer here.
 *
 * A file with no trailing newline gets one before anything is added, so the
 * first variable does not land on the end of an existing line.
 */
export async function writeEnvFile(
  path: string,
  values: Record<string, string>,
  replace: string[] = []
) {
  let contents = await readFile(path, "utf8").catch(() => "")

  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`
    const existing = new RegExp(`^${name}=.*$`, "m")

    if (existing.test(contents)) {
      if (replace.includes(name)) contents = contents.replace(existing, line)
      continue
    }

    const separator = contents && !contents.endsWith("\n") ? "\n" : ""
    contents = `${contents}${separator}${line}\n`
  }

  await writeFile(path, contents)

  return path
}
