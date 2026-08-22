import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: HomePage })

/** A plain landing page, so the interesting routes stay uncluttered. */
function HomePage() {
  return (
    <section className="hero py-12">
      <div className="hero-content text-center">
        <div className="flex max-w-md flex-col items-center gap-6">
          <div className="badge badge-soft badge-primary">
            Neon Data API + row-level security
          </div>

          <h1 className="text-4xl font-bold tracking-tight">Hello world</h1>

          <p className="text-base-content/70">
            This demo signs tokens the Neon Data API trusts. Open your todos to
            see row-level security do the filtering — the page never asks for
            your rows, the database only ever returns them.
          </p>

          <div className="flex gap-2">
            <Link to="/todos" className="btn btn-primary">
              Open your todos
            </Link>
            <Link to="/login" className="btn btn-ghost">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
