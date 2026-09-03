/**
 * A predicate for "this offset is code", so the rewrite leaves comments alone.
 *
 * A doc comment may contain an example that imports something — the testing
 * entry's does — and an example is prose, not a specifier any build resolves.
 * Acting on one either fails the build over a path that was never meant to
 * resolve, or quietly rewrites documentation a reader is meant to copy.
 */
export function codeMask(contents: string) {
  const mask = new Uint8Array(contents.length).fill(1)
  let index = 0

  const hide = (from: number, to: number) => mask.fill(0, from, to)

  while (index < contents.length) {
    const two = contents.slice(index, index + 2)

    if (two === "//") {
      const end = contents.indexOf("\n", index)
      const stop = end === -1 ? contents.length : end
      hide(index, stop)
      index = stop
      continue
    }

    if (two === "/*") {
      const end = contents.indexOf("*/", index + 2)
      const stop = end === -1 ? contents.length : end + 2
      hide(index, stop)
      index = stop
      continue
    }

    const character = contents[index]
    if (character === '"' || character === "'" || character === "`") {
      index++
      while (index < contents.length && contents[index] !== character) {
        index += contents[index] === "\\" ? 2 : 1
      }
    }

    index++
  }

  return mask
}
