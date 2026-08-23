import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query"
import { v7 as uuidv7 } from "uuid"

import { postgrest } from "../db/postgrest"
import type { Todo, TodoInsert } from "../db/schema"

export function useTodos(userId?: string) {
  return useQuery({
    queryKey: ["todos", userId],
    queryFn: userId
      ? async () => {
          const { data } = await postgrest
            .from("todos")
            .select()
            .order("createdAt", { ascending: false })
            .throwOnError()

          return data.map((todo) => ({
            ...todo,
            createdAt: new Date(todo.createdAt),
            updatedAt: new Date(todo.updatedAt)
          }))
        }
      : skipToken
  })
}

export function useInsertTodo(userId?: string) {
  const queryClient = useQueryClient()
  const queryKey = ["todos", userId]

  const mutation = useMutation({
    mutationFn: async (todo: Todo) => {
      await postgrest.from("todos").insert(todo).throwOnError()
    },
    onMutate: async (todo) => {
      await queryClient.cancelQueries({ queryKey })

      queryClient.setQueryData<Todo[]>(queryKey, (todos) =>
        todos ? [todo, ...todos] : undefined
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  })

  const withDefaults = (values: TodoInsert): Todo => {
    if (!userId) throw new Error("Cannot insert a todo while signed out.")
    const now = new Date()

    return {
      id: uuidv7(),
      userId,
      completed: false,
      createdAt: now,
      updatedAt: now,
      ...values
    }
  }

  return {
    ...mutation,
    mutate: (values: TodoInsert) => mutation.mutate(withDefaults(values)),
    mutateAsync: (values: TodoInsert) =>
      mutation.mutateAsync(withDefaults(values))
  }
}

type TodoUpdate = Pick<Todo, "id"> & Partial<Todo>

export function useUpdateTodo(userId?: string) {
  const queryClient = useQueryClient()
  const queryKey = ["todos", userId]

  const mutation = useMutation({
    mutationFn: async ({ id, ...values }: TodoUpdate) => {
      await postgrest.from("todos").update(values).eq("id", id).throwOnError()
    },
    onMutate: async (values) => {
      await queryClient.cancelQueries({ queryKey })

      queryClient.setQueryData<Todo[]>(queryKey, (todos) =>
        todos?.map((todo) =>
          todo.id === values.id ? { ...todo, ...values } : todo
        )
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  })

  const withDefaults = (values: TodoUpdate): TodoUpdate => {
    if (!userId) throw new Error("Cannot update a todo while signed out.")

    return { updatedAt: new Date(), ...values }
  }

  return {
    ...mutation,
    mutate: (values: TodoUpdate) => mutation.mutate(withDefaults(values)),
    mutateAsync: (values: TodoUpdate) =>
      mutation.mutateAsync(withDefaults(values))
  }
}

export function useDeleteTodo(userId?: string) {
  const queryClient = useQueryClient()
  const queryKey = ["todos", userId]

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
