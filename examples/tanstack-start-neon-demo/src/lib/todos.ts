import { dataApi } from "./data-api.ts"

/** A row from the `todos` table. */
export interface Todo {
  id: string
  userId: string
  title: string
  completed: boolean
  createdAt: string
}

/**
 * Lists this user's todos.
 *
 * Note what is missing: any filter on `userId`. The query asks for every row in
 * the table and the database returns only the caller's, because the policy is
 * evaluated against the `sub` claim of the token. That is the whole point of the
 * demo — authorization lives in the database, not in this function.
 */
export async function listTodos() {
  return dataApi<Todo[]>("/todos?order=createdAt.desc")
}

/** Creates a todo. `userId` is filled in by the column default from the token. */
export async function createTodo(title: string) {
  const [created] = await dataApi<Todo[]>("/todos", {
    method: "POST",
    body: JSON.stringify({ title })
  })

  return created
}

/** Toggles completion. */
export async function setTodoCompleted(id: string, completed: boolean) {
  await dataApi(`/todos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ completed })
  })
}

/** Deletes a todo. */
export async function deleteTodo(id: string) {
  await dataApi(`/todos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" })
}
