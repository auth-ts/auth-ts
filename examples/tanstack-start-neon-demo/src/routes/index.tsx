import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useUser } from "../hooks/use-user"
import {
  createTodo,
  deleteTodo,
  listTodos,
  setTodoCompleted
} from "../lib/todos"

export const Route = createFileRoute("/")({ component: TodosPage })

/**
 * The todo list — the whole point of the demo.
 *
 * Nothing here filters by user. The query asks the Data API for every row in the
 * table, and the database returns only this user's, because the policy is
 * evaluated against the `sub` claim of the token this library signed.
 */
function TodosPage() {
  const { data: user, isPending } = useUser()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")

  // Scoped by user id, and cleared on sign-out, so switching accounts cannot
  // paint the previous user's rows from cache for a frame. Row-level security
  // means the data would never be wrong; the render would be.
  const todosKey = ["todos", user?.id]

  const todos = useQuery({
    queryKey: todosKey,
    queryFn: listTodos,
    enabled: Boolean(user)
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: todosKey })
  const add = useMutation({ mutationFn: createTodo, onSuccess: invalidate })
  const toggle = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      setTodoCompleted(id, completed),
    onSuccess: invalidate
  })
  const remove = useMutation({ mutationFn: deleteTodo, onSuccess: invalidate })

  if (isPending) return <p className="text-neutral-500">Loading…</p>

  if (!user) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Your todos</h1>
        <p className="text-neutral-600">
          <Link to="/login" className="underline">
            Sign in
          </Link>{" "}
          to see them. Rows are scoped by row-level security, not by this page.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your todos</h1>
        <p className="text-sm text-neutral-500">
          Signed in as{" "}
          {user.email ?? user.phoneNumber ?? `guest ${user.id.slice(0, 8)}`}
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          add.mutate(title.trim())
          setTitle("")
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Something to do"
          className="flex-1 rounded border border-neutral-300 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-white"
        >
          Add
        </button>
      </form>

      {todos.isError ? (
        <p className="text-red-600">
          Could not load todos: {String(todos.error)}
        </p>
      ) : null}

      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
        {(todos.data ?? []).map((todo) => (
          <li key={todo.id} className="flex items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() =>
                toggle.mutate({ id: todo.id, completed: !todo.completed })
              }
            />
            <span
              className={
                todo.completed
                  ? "flex-1 text-neutral-400 line-through"
                  : "flex-1"
              }
            >
              {todo.title}
            </span>
            <button
              type="button"
              onClick={() => remove.mutate(todo.id)}
              className="text-sm text-neutral-500"
            >
              Delete
            </button>
          </li>
        ))}
        {todos.data?.length === 0 ? (
          <li className="px-4 py-3 text-neutral-500">Nothing yet.</li>
        ) : null}
      </ul>
    </section>
  )
}
