import { createFileRoute } from "@tanstack/react-router"
import { authServer } from "../../../auth-server.ts"

/**
 * The entire auth surface, in one route.
 *
 * Every method forwards to `authServer.handler`, which matches the path below
 * the mount and dispatches. That is the whole integration — mounting the
 * seventeen endpoints individually is possible via `authServer.handlers.*`, but
 * there is rarely a reason to.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => authServer.handler(request),
      POST: ({ request }) => authServer.handler(request),
      PATCH: ({ request }) => authServer.handler(request),
      DELETE: ({ request }) => authServer.handler(request),
      OPTIONS: ({ request }) => authServer.handler(request)
    }
  }
})
