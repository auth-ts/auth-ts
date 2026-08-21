import { createFileRoute, Link } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: LandingPage })

const QUICKSTART = [
  { title: "Install", body: "bun add @auth-ts/server @auth-ts/client" },
  {
    title: "Generate a key",
    body: "Sign with RS256 or ES256. The public half is served for you."
  },
  {
    title: "Write the callbacks",
    body: "Nineteen functions against your own tables. No adapter."
  },
  {
    title: "Mount one route",
    body: "authServer.handler at /api/auth/* handles everything."
  },
  {
    title: "Point your database at it",
    body: "Neon takes the JWKS URL; Supabase takes the issuer."
  }
]

function LandingPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-24">
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">auth-ts</h1>
        <p className="text-fd-muted-foreground text-lg">
          Free forever JWT auth in TypeScript — callbacks to write into any
          database. No adapters, no service, no company.
        </p>
      </div>

      <ol className="space-y-3">
        {QUICKSTART.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="text-fd-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="text-fd-muted-foreground text-sm">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex gap-3">
        <Link
          to="/docs/$"
          params={{ _splat: "" }}
          className="bg-fd-primary text-fd-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
        >
          Read the docs
        </Link>
        <a
          href="https://github.com/auth-ts/auth-ts"
          className="border-fd-border rounded-lg border px-4 py-2 text-sm font-medium"
        >
          GitHub
        </a>
      </div>
    </main>
  )
}
