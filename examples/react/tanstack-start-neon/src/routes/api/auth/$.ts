import { createFileRoute } from "@tanstack/react-router"
import { auth } from "../../../lib/auth"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => auth.handler(request)
    }
  }
})
