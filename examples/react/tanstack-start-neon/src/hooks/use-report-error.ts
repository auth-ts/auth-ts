import { isAuthError } from "@auth-ts/core/client"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { Notice } from "../components/notice"

export const UNEXPECTED = "An unexpected error occurred. Please try again."

/** Shows an error, or sends an expired session to sign in, as the author's pages do. */
export function useReportError() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return async (error: unknown, show: (notice: Notice) => void) => {
    if (isAuthError(error) && error.code === "unauthenticated") {
      await queryClient.resetQueries()
      await navigate({ to: "/login", search: { error: "sessionExpired" } })
      return
    }
    show({
      text: isAuthError(error) ? error.message : UNEXPECTED,
      tone: "error"
    })
  }
}
