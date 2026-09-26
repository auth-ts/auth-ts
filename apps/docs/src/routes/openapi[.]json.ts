import { createFileRoute } from "@tanstack/react-router"
import { apiDocument } from "~/lib/openapi"

/**
 * The spec as a file, for anything that takes a URL.
 *
 * The rendered reference is the same document; this is the copy you paste into
 * Postman or hand to a client generator.
 */
export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      GET: () => Response.json(apiDocument())
    }
  }
})
