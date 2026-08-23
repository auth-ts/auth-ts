import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { authClient } from "../lib/auth-client"

/** A row from the `todos` table. */
export interface Todo {
  id: string
  userId: string
  title: string
  completed: boolean
  createdAt: string
}

const DATA_API_URL = import.meta.env.VITE_NEON_DATA_API_URL ?? ""

/**
 * Calls the Neon Data API with the current access token.
 *
 * The entire data plane: a `fetch` with no client library in between, so the
 * thing being demonstrated — our JWT producing row-scoped results — is visible
 * in one place. On a 401 it drops the cached token and retries **once**; if the
 * second attempt is also refused the session is genuinely gone.
 */
async function dataApi<Result>(path: string, init: RequestInit = {}) {
  const send = async () =>
    fetch(`${DATA_API_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await authClient.getToken()}`,
        "content-type": "application/json",
        prefer: "return=representation"
      }
    })

  let response = await send()
  if (response.status === 401) {
    authClient.clearToken()
    response = await send()
  }
  if (!response.ok) {
    throw new Error(`Data API ${response.status}: ${await response.text()}`)
  }

  return (response.status === 204 ? undefined : await response.json()) as Result
}

/**
 * This user's todos, and the three ways to change them.
 *
 * Nothing here filters by user. The list asks for every row in the table and
 * the database returns only the caller's, because the policy is evaluated
 * against the `sub` claim of the token — authorization lives in the database,
 * not in this hook. `userId` on insert is filled in by the column default from
 * the same token.
 *
 * Keyed by user id and disabled when signed out, so switching accounts cannot
 * paint the previous user's rows from cache for a frame. Row-level security
 * means the data would never be wrong; the render would be.
 */
export function useTodos(userId: string | undefined) {
  const queryClient = useQueryClient()
  const queryKey = ["todos", userId]
  const onSuccess = () => queryClient.invalidateQueries({ queryKey })

  const todos = useQuery({
    queryKey,
    queryFn: () => dataApi<Todo[]>("/todos?order=createdAt.desc"),
    enabled: Boolean(userId)
  })
  const add = useMutation({
    mutationFn: (title: string) =>
      dataApi<Todo[]>("/todos", {
        method: "POST",
        body: JSON.stringify({ title })
      }),
    onSuccess
  })
  const toggle = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      dataApi(`/todos?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ completed })
      }),
    onSuccess
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      dataApi(`/todos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess
  })

  return { todos, add, toggle, remove }
}
