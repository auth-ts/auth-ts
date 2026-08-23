import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { dataApi } from "../lib/data-api"

/** Unwraps a PostgREST result, throwing so the query library sees the failure. */
function unwrap<T>({
  data,
  error
}: {
  data: T
  error: { message: string } | null
}) {
  if (error) throw new Error(error.message)
  return data
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
    queryFn: async () =>
      unwrap(
        await dataApi
          .from("todos")
          .select()
          .order("createdAt", { ascending: false })
      ),
    enabled: Boolean(userId)
  })
  const add = useMutation({
    mutationFn: async (title: string) =>
      unwrap(await dataApi.from("todos").insert({ title })),
    onSuccess
  })
  const toggle = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) =>
      unwrap(await dataApi.from("todos").update({ completed }).eq("id", id)),
    onSuccess
  })
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await dataApi.from("todos").delete().eq("id", id)),
    onSuccess
  })

  return { todos, add, toggle, remove }
}
