import { createFileRoute } from "@tanstack/react-router"
import { auth } from "../../../lib/auth"

/**
 * The entire auth surface, in one route.
 *
 * Every method forwards to `auth.handler`, which matches the path below
 * the mount and dispatches. That is the whole integration — mounting each
 * endpoint individually is possible via `auth.handlers.*`, but
 * there is rarely a reason to.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => auth.handler(request)
    }
  }
})
