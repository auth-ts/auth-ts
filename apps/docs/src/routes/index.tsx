import { createFileRoute, Link } from "@tanstack/react-router"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import { Logo } from "~/components/logo"
import { baseOptions, REPO_URL } from "~/lib/layout.shared"

export const Route = createFileRoute("/")({ component: LandingPage })

const FEATURES = [
  {
    title: "No adapters",
    body: "Nineteen callbacks against your own tables. The library never sees your schema, your migrations, or your data."
  },
  {
    title: "Your keys, your issuer",
    body: "RS256 or ES256, signed by you. The public half is served at a JWKS URL that any verifier can read."
  },
  {
    title: "Authorization in Postgres",
    body: "Built for PostgREST and row-level security — Neon's Data API, Supabase, or self-hosted. Your policies decide what comes back."
  },
  {
    title: "Runs anywhere",
    body: "Zero framework dependencies, jose and nothing else. Node 20+, Cloudflare Workers, Deno, and Bun."
  },
  {
    title: "Sign-in that people use",
    body: "Email and SMS magic codes, GitHub, Google, and anonymous guests that can be upgraded in place."
  },
  {
    title: "Free forever",
    body: "A library, not a service. No dashboard, no seat pricing, no company that can change the terms."
  }
]

const SERVER_SNIPPET = `import { createAuthServer } from "@auth-ts/server"

export const authServer = createAuthServer({
  db: {
    /* your queries — see the AuthDb reference */
  },
  email: {
    sendCode: async ({ email, code }) => {
      await yourEmailProvider.send({ to: email, text: code })
    }
  }
})`

const CLIENT_SNIPPET = `import { createAuthClient } from "@auth-ts/client"

export const authClient = createAuthClient()

await authClient.sendCode({ email })
await authClient.verifyCode({ email, code })

// Hand this to your PostgREST client as its access token.
const token = await authClient.getToken()`

function LandingPage() {
  return (
    <HomeLayout
      {...baseOptions()}
      links={[{ text: "Documentation", url: "/docs", active: "nested-url" }]}
    >
      <Hero />
      <Features />
      <Snippets />
      <Closing />
    </HomeLayout>
  )
}

function Hero() {
  return (
    <section className="border-fd-border relative overflow-hidden border-b">
      {/* A soft wash behind the fold, so the first screen is not flat white. */}
      <div
        aria-hidden
        className="from-fd-primary/10 pointer-events-none absolute inset-0 bg-radial-[at_50%_0%] to-transparent to-70%"
      />
      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-24 text-center md:py-32">
        <Logo className="text-fd-primary size-14" />
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
          Free forever JWT auth in TypeScript
        </h1>
        <p className="text-fd-muted-foreground max-w-2xl text-lg text-pretty md:text-xl">
          Callbacks to write into any database. No adapters, no service, no
          company — your application issues its own tokens, and Postgres decides
          what they can reach.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
          >
            Get started
          </Link>
          <a
            href={REPO_URL}
            className="border-fd-border bg-fd-card hover:bg-fd-accent hover:text-fd-accent-foreground rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            GitHub
          </a>
        </div>
        <code className="border-fd-border bg-fd-card text-fd-muted-foreground mt-2 rounded-lg border px-4 py-2 font-mono text-sm">
          bun add @auth-ts/server @auth-ts/client
        </code>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="border-fd-border mx-auto grid max-w-5xl border-b sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((feature) => (
        <div
          key={feature.title}
          className="border-fd-border border-t p-6 sm:[&:nth-child(-n+2)]:border-t-0 sm:odd:border-r lg:[&:nth-child(-n+3)]:border-t-0 lg:odd:border-r-0 lg:[&:not(:nth-child(3n))]:border-r"
        >
          <h2 className="font-medium">{feature.title}</h2>
          <p className="text-fd-muted-foreground mt-2 text-sm text-pretty">
            {feature.body}
          </p>
        </div>
      ))}
    </section>
  )
}

function Snippets() {
  return (
    <section className="mx-auto grid max-w-5xl gap-8 px-6 py-16 lg:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">On the server</h2>
        <p className="text-fd-muted-foreground text-sm text-pretty">
          Write the callbacks, mount <code>authServer.handler</code> once at{" "}
          <code>/api/auth/*</code>, and point your database at the JWKS URL.
        </p>
        <DynamicCodeBlock lang="ts" code={SERVER_SNIPPET} />
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">In the browser</h2>
        <p className="text-fd-muted-foreground text-sm text-pretty">
          Zero runtime dependencies. The access token lives in memory only, and
          is refreshed from an httpOnly cookie.
        </p>
        <DynamicCodeBlock lang="ts" code={CLIENT_SNIPPET} />
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section className="border-fd-border border-t">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Five steps to a signed token
        </h2>
        <p className="text-fd-muted-foreground max-w-xl text-pretty">
          Install, generate a key, write the callbacks, mount one route, and
          point your database at it.
        </p>
        <Link
          to="/docs/$"
          params={{ _splat: "" }}
          className="bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 mt-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
        >
          Read the introduction
        </Link>
      </div>
    </section>
  )
}
