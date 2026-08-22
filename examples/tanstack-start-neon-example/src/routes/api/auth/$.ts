import { createFileRoute } from "@tanstack/react-router"
import { authServer } from "../../../lib/auth-server"

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
      ANY: ({ request }) => authServer.handler(request)
    }
  }
})
