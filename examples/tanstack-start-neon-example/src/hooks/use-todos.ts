import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query"
import { v7 as uuidv7 } from "uuid"

import { postgrest, reviveDates } from "../db/postgrest"
import type { Todo, TodoInsert } from "../db/schema"

export const todosQueryKey = (userId?: string) => ["todos", userId]

export function useTodos(userId?: string) {
  return useQuery({
    queryKey: todosQueryKey(userId),
    queryFn: userId
      ? async () => {
          const { data } = await postgrest
            .from("todos")
            .select()
            .order("createdAt", { ascending: false })
            .throwOnError()

          return data.map((todo) => reviveDates(todo, "createdAt", "updatedAt"))
        }
      : skipToken
  })
}

export function useInsertTodo(userId?: string) {
  const queryClient = useQueryClient()
  const queryKey = todosQueryKey(userId)

  return useMutation({
    mutationFn: async (values: TodoInsert) => {
      if (!userId) throw new Error("Cannot insert a todo while signed out.")
      const { data } = await postgrest
        .from("todos")
        .insert(values)
        .select()
        .single()
        .throwOnError()

      return reviveDates(data, "createdAt", "updatedAt")
    },
    onMutate: async (values) => {
      if (!userId) return
      await queryClient.cancelQueries({ queryKey })
      const now = new Date()

      queryClient.setQueryData<Todo[]>(queryKey, (todos) =>
        todos
          ? [
              {
                id: uuidv7(),
                userId,
                completed: false,
                createdAt: now,
                updatedAt: now,
                ...values
              },
              ...todos
            ]
          : undefined
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  })
}

type TodoUpdate = Pick<Todo, "id"> & Partial<Todo>

export function useUpdateTodo(userId?: string) {
  const queryClient = useQueryClient()
  const queryKey = todosQueryKey(userId)

  return useMutation({
    mutationFn: async ({ id, ...values }: TodoUpdate) => {
      if (!userId) throw new Error("Cannot update a todo while signed out.")
      const { data } = await postgrest
        .from("todos")
        .update({ updatedAt: new Date(), ...values })
        .eq("id", id)
        .select()
        .single()
        .throwOnError()

      return reviveDates(data, "createdAt", "updatedAt")
    },
    onMutate: async (values) => {
      if (!userId) return
      await queryClient.cancelQueries({ queryKey })

      queryClient.setQueryData<Todo[]>(queryKey, (todos) =>
        todos?.map((todo) =>
          todo.id === values.id
            ? { ...todo, updatedAt: new Date(), ...values }
            : todo
        )
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  })
}

export function useDeleteTodo(userId?: string) {
  const queryClient = useQueryClient()
  const queryKey = todosQueryKey(userId)

  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Cannot delete a todo while signed out.")
      await postgrest.from("todos").delete().eq("id", id).throwOnError()
    },
    onMutate: async (id) => {
      if (!userId) return
      await queryClient.cancelQueries({ queryKey })

      queryClient.setQueryData<Todo[]>(queryKey, (todos) =>
        todos?.filter((todo) => todo.id !== id)
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  })
}
