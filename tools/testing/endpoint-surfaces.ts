import { readFileSync } from "node:fs"

/** One request a client method issues, as the source describes it. */
export interface ClientCall {
  /** The method's name on `authClient`. */
  name: string
  method: string
  /** Path under the mount, with `$` for each interpolated segment. */
  path: string
}

// The factory's name is the mapping: `createListSessions` provides
// `authClient.listSessions`. Reading it here rather than the name of whatever
// the factory returns is what makes the object-of-arrows shape in `get-token.ts`
// resolve the same way as the plain functions everywhere else.
const FACTORY = /export function create(\w+)\s*\(/g
const NAMED_FUNCTION = /(?:async )?function (\w+)\s*\(/g
const FETCH_METHOD = /method:\s*"(GET|POST|DELETE)"/
const FETCH_PATH = /path:\s*(?:"([^"]*)"|`([^`]*)`)/

/**
 * The body of the function whose parameter list opens at `from`.
 *
 * Two things sit between the signature and the body and both contain braces: a
 * default like `input: SignOutInput = {}`, and a return type like
 * `Promise<{ switchedTo: AuthUser } | null>`. The first is skipped by paren
 * matching, the second by ignoring any brace inside angle brackets.
 */
function functionBody(source: string, from: number) {
  let parens = 0
  let afterParameters = from
  for (let cursor = from; cursor < source.length; cursor++) {
    if (source[cursor] === "(") parens++
    if (source[cursor] === ")") {
      parens--
      if (parens === 0) {
        afterParameters = cursor + 1
        break
      }
    }
  }

  let angles = 0
  let opening = -1
  for (let cursor = afterParameters; cursor < source.length; cursor++) {
    const character = source[cursor]
    if (character === "<") angles++
    if (character === ">") angles = Math.max(0, angles - 1)
    if (character === "{" && angles === 0) {
      opening = cursor
      break
    }
  }
  if (opening === -1) return ""

  let depth = 0
  for (let cursor = opening; cursor < source.length; cursor++) {
    const character = source[cursor]
    if (character === "{") depth++
    if (character === "}") {
      depth--
      if (depth === 0) return source.slice(opening, cursor + 1)
    }
  }

  return source.slice(opening)
}

/** `/identities/${encodeURIComponent(input.id)}` reads as `/identities/$`. */
function normalizePath(path: string) {
  return path.replace(/\$\{[^}]*\}/g, "$")
}

function requestIn(body: string) {
  const method = FETCH_METHOD.exec(body)?.[1]
  const matched = FETCH_PATH.exec(body)
  const path = matched?.[1] ?? matched?.[2]
  if (method === undefined || path === undefined) return null

  return { method, path: normalizePath(path) }
}

/**
 * Every request the client issues, keyed by the method that issues it.
 *
 * Read from source text rather than by calling anything: the point is to compare
 * the paths the client has hard-coded against the routes the server declares,
 * and a running client would just agree with itself. TypeScript 7 ships no
 * compiler API, so this matches the regex-over-lines approach used beside it.
 *
 * A method that delegates to a helper in the same file is followed one hop, with
 * the helper's own path parameter substituted — which is how the two OAuth
 * methods, both of which go through one shared flow, are resolved.
 */
export function clientCalls(filePath: string) {
  return clientCallsInSource(readFileSync(filePath, "utf8"))
}

/** The extraction behind {@link clientCalls}, on source text. */
export function clientCallsInSource(source: string) {
  const helpers: Record<string, { method: string; path: string }> = {}
  NAMED_FUNCTION.lastIndex = 0
  for (const match of source.matchAll(NAMED_FUNCTION)) {
    const name = match[1]
    if (name === undefined) continue

    const request = requestIn(
      functionBody(source, match.index + match[0].length - 1)
    )
    if (request) helpers[name] = request
  }

  const calls: ClientCall[] = []
  FACTORY.lastIndex = 0
  for (const match of source.matchAll(FACTORY)) {
    const captured = match[1]
    if (captured === undefined) continue
    const name = captured.charAt(0).toLowerCase() + captured.slice(1)

    const body = functionBody(source, match.index + match[0].length - 1)
    const direct = requestIn(body)
    if (direct) {
      calls.push({ name, ...direct })
      continue
    }

    for (const [helper, request] of Object.entries(helpers)) {
      const delegated = new RegExp(`${helper}\\([^)]*?"([^"]*)"`).exec(body)
      if (!delegated?.[1]) continue

      calls.push({
        name,
        method: request.method,
        // The helper's own path is built from the argument, so substituting it
        // is what turns `${path}/${provider}` into the real route.
        path: normalizePath(request.path.replace(/^\$/, delegated[1]))
      })
      break
    }
  }

  return calls
}

/** One route the server declares. */
export interface ServerRoute {
  name: string
  method: string
  /** Path under the mount, with `$` for each dynamic segment. */
  path: string
}

const DEFINED_ENDPOINT =
  /export const (\w+) = defineEndpoint\(\{\s*method:\s*"(GET|POST|DELETE)",\s*path:\s*"([^"]*)"/g

/**
 * Every route the server declares, read from the endpoint files.
 *
 * Read rather than imported so neither package has to depend on the other's
 * internals to check that the two agree: the registry is not public API, and
 * exporting it just to test the seam would make it one.
 */
export function serverRoutes(filePath: string) {
  return serverRoutesInSource(readFileSync(filePath, "utf8"))
}

/** The extraction behind {@link serverRoutes}, on source text. */
export function serverRoutesInSource(source: string) {
  DEFINED_ENDPOINT.lastIndex = 0

  return [...source.matchAll(DEFINED_ENDPOINT)].flatMap<ServerRoute>(
    (match) => {
      const [, name, method, path] = match
      if (!name || !method || path === undefined) return []

      return [{ name, method, path: path.replace(/\$\w+/g, "$") }]
    }
  )
}
