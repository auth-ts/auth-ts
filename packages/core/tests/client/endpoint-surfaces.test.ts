import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  clientCalls,
  serverRoutes
} from "../../../../tools/testing/endpoint-surfaces"

const METHODS = join(__dirname, "../../src/client/methods")
const ENDPOINTS = join(__dirname, "../../src/endpoints")

// The routes with no client method, and why. Another cannot join this list by
// accident: the test names them, so removing a client method fails.
const SERVER_ONLY = {
  callbackProvider: "a top-level browser navigation, not a fetch",
  getJwks: "read by third-party verifiers, never by this client",
  getDiscovery: "read by third-party verifiers, never by this client",
  getOpenAPIDocument: "documentation, served to tools rather than to an app",
  getReference: "documentation, served to browsers rather than to an app"
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)

    return path.endsWith(".ts") ? [path] : []
  })
}

const calls = sourceFiles(METHODS).flatMap((file) => clientCalls(file))
const routes = sourceFiles(ENDPOINTS).flatMap((file) => serverRoutes(file))
const byName = new Map(routes.map((route) => [route.name, route]))

describe("client and server endpoint surfaces", () => {
  it("finds a request for every client method", () => {
    expect(calls.length).toBeGreaterThan(0)
  })

  it("names each method after the endpoint it calls", () => {
    const unknown = calls
      .map((call) => call.name)
      .filter((name) => !byName.has(name))

    expect(unknown).toEqual([])
  })

  it("covers every endpoint a client is meant to reach", () => {
    const reached = new Set(calls.map((call) => call.name))
    const missing = routes
      .map((route) => route.name)
      .filter((name) => !reached.has(name) && !(name in SERVER_ONLY))

    expect(missing).toEqual([])
  })

  it("requests the path and method the endpoint declares", () => {
    const mismatched = calls.flatMap((call) => {
      const route = byName.get(call.name)
      if (!route) return []
      if (route.path === call.path && route.method === call.method) return []

      return [
        `${call.name}: client ${call.method} ${call.path}, server ${route.method} ${route.path}`
      ]
    })

    expect(mismatched).toEqual([])
  })
})
