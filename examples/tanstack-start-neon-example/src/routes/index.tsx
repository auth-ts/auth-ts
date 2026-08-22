import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: HomePage })

/** A plain landing page, so the interesting routes stay uncluttered. */
function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Hello world</h1>
      <p className="text-neutral-400">
        This demo signs tokens the Neon Data API trusts. Head to{" "}
        <Link to="/todos" className="underline">
          your todos
        </Link>{" "}
        to see row-level security do the filtering.
      </p>
    </section>
  )
}
