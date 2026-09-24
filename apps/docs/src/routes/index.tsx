import { createFileRoute, Link } from "@tanstack/react-router"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import { ArrowRight } from "lucide-react"
import { Fragment } from "react"
import { GitHubIcon } from "~/components/github-icon"
import { Logo } from "~/components/logo"
import { baseOptions, REPO_URL } from "~/lib/layout.shared"
import authSource from "../../content/snippets/auth.ts?raw"
import authClientSource from "../../content/snippets/auth-client.ts?raw"
import authDatabaseSource from "../../content/snippets/auth-database-drizzle.ts?raw"

export const Route = createFileRoute("/")({ component: LandingPage })

const CLAIMS = ["No limits", "No service", "No company"]

const SPECS = [
  ["Runtime", "Node 20+, Workers, Deno, Bun"],
  ["Algorithms", "ES256, RS256"],
  ["Dependencies", "jose"],
  ["License", "Apache-2.0"]
]

const FLOW = [
  {
    title: "The browser",
    body: "Signs in at /api/auth. Keeps an HttpOnly refresh cookie, and the access token in memory."
  },
  {
    title: "Your server",
    body: "Checks codes and providers, then signs a short-lived JWT with your key."
  },
  {
    title: "Your API or database",
    body: "Verifies the JWT against your jwks.json, with verifyToken or any JWKS verifier."
  }
]

const TOKEN = `{
  "sub": "0199a3c4-7e1b-7c3a-9f2e-4b8d1e6a2c10",
  "role": "authenticated",
  "type": "user",
  "amr": ["otp"],
  "exp": 1771203600
}`

const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router"
import { auth } from "~/lib/auth"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => auth.handler(request)
    }
  }
})
`

const API_SOURCE = `import { auth } from "./auth"

export async function requireUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
  const claims = token ? await auth.verifyToken(token) : null

  if (!claims) throw new Response("Unauthorized", { status: 401 })

  return claims
}
`

const FILES = [
  { name: "lib/auth.ts", lang: "ts", code: authSource },
  { name: "routes/api/auth/$.ts", lang: "ts", code: ROUTE_SOURCE },
  { name: "lib/auth-client.ts", lang: "ts", code: authClientSource },
  { name: "lib/require-user.ts", lang: "ts", code: API_SOURCE },
  { name: "lib/auth-database.ts", lang: "ts", code: authDatabaseSource }
]

const FEATURES = [
  {
    title: "Your tables, four functions",
    body: "No adapters. Six tables you own, and select, insert, update and delete to reach them."
  },
  {
    title: "JWTs anything can verify",
    body: "Check tokens in your own routes, or hand them to Neon, Supabase or PostgREST."
  },
  {
    title: "Every common sign-in",
    body: "Email and SMS codes, GitHub, Google and guests, with devices and account switching."
  }
]

function LandingPage() {
  return (
    <HomeLayout
      {...baseOptions()}
      links={[
        { text: "Docs", url: "/docs", active: "nested-url" },
        { text: "Reference", url: "/docs/reference/create-auth" }
      ]}
    >
      <Hero />
      <HowItWorks />
      <CodeTour />
      <Features />
      <Footer />
    </HomeLayout>
  )
}

function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="hero-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="hero-stars hero-stars-far" />
      <div className="hero-stars hero-stars-near" />
      <div className="hero-glow hero-glow-near" />
      <div className="hero-glow hero-glow-far" />
      <div className="hero-noise" />
    </div>
  )
}

function Hero() {
  return (
    <section className="border-fd-border relative isolate overflow-hidden border-b">
      <HeroBackdrop />
      <div className="relative mx-auto grid max-w-5xl grid-cols-1 gap-x-12 gap-y-10 px-6 py-20 md:py-28 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <h1 className="flex flex-col gap-4">
            <span className="flex items-center gap-2 font-mono text-5xl font-semibold tracking-tighter md:gap-3 md:text-7xl">
              <Logo className="text-fd-primary size-15 md:size-22" />
              auth.ts
            </span>
            <span className="max-w-lg text-2xl font-medium tracking-tight text-balance md:text-3xl">
              <span className="before:bg-fd-primary relative whitespace-nowrap before:absolute before:inset-x-0 before:bottom-[-0.015em] before:h-[max(3px,0.07em)] before:rounded-full before:content-['']">
                Free forever
              </span>{" "}
              auth in TypeScript.
            </span>
          </h1>
          <p className="text-fd-muted-foreground mt-6 max-w-lg text-pretty">
            Sign-in, sessions and JWTs for any TypeScript app. Bring your own
            database and framework.
          </p>
          <p className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-medium">
            {CLAIMS.map((claim, index) => (
              <Fragment key={claim}>
                {index > 0 && (
                  <span aria-hidden className="text-fd-primary">
                    /
                  </span>
                )}
                {claim}
              </Fragment>
            ))}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              to="/docs/$"
              params={{ _splat: "quickstart" }}
              className="bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
            >
              Get started
              <ArrowRight className="size-4" />
            </Link>
            <a
              href={REPO_URL}
              className="hover:text-fd-primary inline-flex items-center gap-2 text-sm font-medium transition-colors"
            >
              <GitHubIcon className="size-4" />
              GitHub
            </a>
          </div>
          <div className="mt-8 max-w-md">
            <DynamicCodeBlock
              lang="bash"
              code={`npm install @auth-ts/core
npx @auth-ts/cli keygen`}
            />
          </div>
        </div>
        <div>
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs tracking-wider uppercase">
            Package
          </p>
          <dl className="text-sm">
            {SPECS.map(([term, value]) => (
              <div
                key={term}
                className="border-fd-border flex items-baseline justify-between gap-6 border-b py-2.5 first:border-t"
              >
                <dt className="text-fd-muted-foreground">{term}</dt>
                <dd className="text-end font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="border-fd-border border-b">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-3 md:grid-cols-3">
          {FLOW.map((step, index) => (
            <li
              key={step.title}
              className="border-fd-border bg-fd-card rounded-xl border p-4"
            >
              <p className="text-fd-primary font-mono text-xs">
                Step {index + 1}
              </p>
              <p className="mt-1.5 font-medium">{step.title}</p>
              <p className="text-fd-muted-foreground mt-1.5 text-sm text-pretty">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
          <p className="text-fd-muted-foreground text-pretty">
            What every verifier reads: <code>sub</code> is the user and{" "}
            <code>type</code> their role.
          </p>
          <div className="min-w-0">
            <DynamicCodeBlock lang="json" code={TOKEN} />
          </div>
        </div>
      </div>
    </section>
  )
}

function CodeTour() {
  return (
    <section className="border-fd-border border-b">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          The whole setup
        </h2>
        <p className="text-fd-muted-foreground mt-2 max-w-xl text-pretty">
          Five files, the same ones the quickstart walks through.
        </p>
        <Tabs
          items={FILES.map((file) => file.name)}
          className="mt-6 [&_pre]:max-h-[28rem]"
        >
          {FILES.map((file) => (
            <Tab key={file.name} value={file.name}>
              <DynamicCodeBlock lang={file.lang} code={file.code} />
            </Tab>
          ))}
        </Tabs>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="border-fd-border border-b">
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-16 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title}>
            <h2 className="text-lg font-semibold tracking-tight">
              {feature.title}
            </h2>
            <p className="text-fd-muted-foreground mt-2 text-pretty">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-6 py-10 text-sm">
      <nav className="flex flex-wrap gap-x-6 gap-y-2 font-medium">
        <Link to="/docs/$" params={{ _splat: "quickstart" }}>
          Quickstart
        </Link>
        <Link to="/docs/$" params={{ _splat: "reference/create-auth" }}>
          Reference
        </Link>
        <a href={REPO_URL}>GitHub</a>
        <a href="/llms.txt">llms.txt</a>
      </nav>
      <p className="text-fd-muted-foreground">
        Apache-2.0. Built on{" "}
        <a href="https://lucia-auth.com" className="underline">
          Lucia
        </a>{" "}
        and{" "}
        <a href="https://thecopenhagenbook.com" className="underline">
          The Copenhagen Book
        </a>
        .
      </p>
    </footer>
  )
}
