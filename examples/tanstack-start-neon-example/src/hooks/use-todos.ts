import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { postgrest } from "../db/postgrest"

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
    queryFn: () =>
      postgrest
        .from("todos")
        .select()
        .order("createdAt", { ascending: false })
        .throwOnError()
        .then(({ data }) => data),
    enabled: Boolean(userId)
  })
  const add = useMutation({
    mutationFn: async (title: string) => {
      await postgrest.from("todos").insert({ title }).throwOnError()
    },
    onSuccess
  })
  const toggle = useMutation({
    mutationFn: async ({
      id,
      completed
    }: {
      id: string
      completed: boolean
    }) => {
      await postgrest
        .from("todos")
        .update({ completed })
        .eq("id", id)
        .throwOnError()
    },
    onSuccess
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      await postgrest.from("todos").delete().eq("id", id).throwOnError()
    },
    onSuccess
  })

  return { todos, add, toggle, remove }
}
