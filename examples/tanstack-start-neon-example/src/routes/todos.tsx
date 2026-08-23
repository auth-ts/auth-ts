import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"

import { TrashIcon } from "../components/icons"
import { useUser } from "../hooks/use-user"
import {
  createTodo,
  deleteTodo,
  listTodos,
  setTodoCompleted
} from "../lib/todos"

export const Route = createFileRoute("/todos")({ component: TodosPage })

/**
 * The todo list — the whole point of the demo.
 *
 * Nothing here filters by user. The query asks the Data API for every row in the
 * table, and the database returns only this user's, because the policy is
 * evaluated against the `sub` claim of the token this library signed.
 */
function TodosPage() {
  const { data, isPending } = useUser()
  const user = data?.user
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

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (!user) {
    return (
      <section className="mx-auto max-w-sm">
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body items-center gap-4 text-center">
            <h1 className="card-title text-2xl">Your todos</h1>
            <p className="text-base-content/70">
              Sign in to see them. Rows are scoped by row-level security, not by
              this page.
            </p>
            <Link to="/login" className="btn btn-primary">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const remaining = (todos.data ?? []).filter((todo) => !todo.completed).length

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your todos</h1>
          <p className="text-sm text-base-content/60">
            Signed in as{" "}
            {user.email ?? user.phoneNumber ?? `guest ${user.id.slice(0, 8)}`}
          </p>
        </div>
        {todos.data ? (
          <div className="badge badge-soft badge-primary">{remaining} left</div>
        ) : null}
      </div>

      <form
        className="join w-full"
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
          className="input join-item flex-1"
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="btn btn-primary join-item"
        >
          Add
        </button>
      </form>

      {todos.isError ? (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          <span>Could not load todos: {String(todos.error)}</span>
        </div>
      ) : null}

      <ul className="list rounded-box bg-base-100 shadow-sm">
        {todos.isPending ? (
          <li className="p-4 text-center">
            <span className="loading loading-dots" />
          </li>
        ) : null}
        {(todos.data ?? []).map((todo) => (
          <li key={todo.id} className="list-row items-center">
            <input
              type="checkbox"
              className="checkbox checkbox-primary"
              checked={todo.completed}
              onChange={() =>
                toggle.mutate({ id: todo.id, completed: !todo.completed })
              }
            />
            <span
              className={
                todo.completed
                  ? "list-col-grow text-base-content/40 line-through"
                  : "list-col-grow"
              }
            >
              {todo.title}
            </span>
            <button
              type="button"
              onClick={() => remove.mutate(todo.id)}
              aria-label={`Delete ${todo.title}`}
              className="btn btn-ghost btn-square btn-sm text-base-content/60"
            >
              <TrashIcon />
            </button>
          </li>
        ))}
        {todos.data?.length === 0 ? (
          <li className="p-4 text-center text-sm text-base-content/60">
            Nothing yet — add one above.
          </li>
        ) : null}
      </ul>
    </section>
  )
}
