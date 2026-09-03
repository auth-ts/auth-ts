import {
  ExclamationCircleIcon,
  PlusIcon,
  TrashIcon
} from "@heroicons/react/24/outline"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

import type { Notice } from "../components/notice"
import { NoticeAlert } from "../components/notice"
import { PendingSpinner } from "../components/pending-spinner"
import { SignedOutCard } from "../components/signed-out-card"
import {
  useDeleteTodo,
  useInsertTodo,
  useTodos,
  useUpdateTodo
} from "../hooks/use-todos"
import { useUser } from "../hooks/use-user"

export const Route = createFileRoute("/todos")({
  component: TodosPage,
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {}
})

/** A failed OAuth flow lands back here with its code in `?error=`. */
const signInFailures: Record<string, string> = {
  providerDenied: "That sign-in was cancelled.",
  providerRejected: "That sign-in could not be completed. Please try again.",
  providerEmailUnverified:
    "Verify your email address with that provider, then try again.",
  providerUnavailable: "The provider did not respond. Please try again.",
  providerConflict: "That account is already connected to a different user.",
  invalidState: "That sign-in attempt expired. Please start again."
}

/** The todo list — the whole point of the demo. */
function TodosPage() {
  const { error } = Route.useSearch()
  const { data: user, isPending } = useUser()
  const todos = useTodos(user?.id)
  const add = useInsertTodo(user?.id)
  const toggle = useUpdateTodo(user?.id)
  const remove = useDeleteTodo(user?.id)
  const [title, setTitle] = useState("")

  if (isPending) return <PendingSpinner />

  if (!user) {
    const notice: Notice | null = error
      ? { text: signInFailures[error] ?? "That sign-in failed.", tone: "error" }
      : null

    return (
      <div className="flex flex-col items-center gap-4">
        {notice ? (
          <div className="w-full max-w-sm">
            <NoticeAlert notice={notice} />
          </div>
        ) : null}
        <SignedOutCard title="Your todos">
          Sign in to see them. Rows are scoped by row-level security, not by
          this page.
        </SignedOutCard>
      </div>
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
          add.mutate({ title: title.trim() })
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
          <PlusIcon className="size-4" />
          Add
        </button>
      </form>

      {todos.isError ? (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          <ExclamationCircleIcon className="size-4 shrink-0" />
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
              <TrashIcon className="size-4" />
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
