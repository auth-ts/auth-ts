import { createFileRoute, Link } from "@tanstack/react-router"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import { ArrowRight } from "lucide-react"
import { Fragment } from "react"
import { GitHubIcon } from "~/components/github-icon"
import { Logo } from "~/components/logo"
import { baseOptions, REPO_URL } from "~/lib/layout.shared"

export const Route = createFileRoute("/")({ component: LandingPage })

/**
 * The facts a reader would otherwise have to open package.json for. Kept beside
 * the mark rather than buried in the feature list because they are the questions
 * that decide whether the rest of the page is worth reading.
 */
/**
 * The three claims, lifted out of the paragraph they used to end. Set apart
 * they carry the argument; buried behind an em-dash they read as an aside.
 */
const CLAIMS = ["No adapters", "No service", "No company"]

const SPECS = [
  ["Runtime", "Node 20+, Workers, Deno, Bun"],
  ["Algorithms", "RS256, ES256"],
  ["Dependencies", "jose"],
  ["License", "Apache-2.0"]
]

const FEATURES = [
  {
    title: "No adapters",
    body: "A handful of callbacks against your own tables. The library never sees your schema, your migrations, or your data."
  },
  {
    title: "Your keys, your issuer",
    body: "RS256 or ES256, signed by you. The public half is served at a JWKS URL that any verifier can read."
  },
  {
    title: "Authorization in the database",
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

/**
 * Drifting glows over two parallax star layers. Decorative and inert: no JS, no
 * canvas, `aria-hidden`, and it holds still under `prefers-reduced-motion`.
 * The layer geometry and keyframes live in `styles.css`.
 */
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
          {/*
           * The mark and the wordmark are one line and the largest thing here.
           * The sentence under them is the descriptive half of the heading, so
           * it stays inside the h1 rather than becoming a second element.
           */}
          <h1 className="flex flex-col gap-4">
            <span className="flex items-center gap-2 text-5xl font-semibold tracking-tighter md:gap-3 md:text-7xl">
              <Logo className="text-fd-primary size-15 md:size-22" />
              Auth.ts
            </span>
            <span className="max-w-lg text-2xl font-medium tracking-tight text-balance md:text-3xl">
              {/*
               * A drawn double rule rather than `underline`: text-decoration
               * sits at a fixed offset and hugs the descenders, so at display
               * sizes it reads as a typo'd link. These two bars are in `em`, so
               * the weight and the space between them hold as the heading
               * changes size. "Free forever" has no descenders to clear, which
               * is what lets them sit this close to the baseline.
               */}
              <span className="relative whitespace-nowrap before:absolute before:inset-x-0 before:-bottom-[0.08em] before:h-[0.055em] before:rounded-full before:bg-fd-primary before:content-[''] after:absolute after:inset-x-0 after:bottom-[0.05em] after:h-[0.055em] after:rounded-full after:bg-fd-primary after:content-['']">
                Free forever
              </span>{" "}
              auth in TypeScript.
            </span>
          </h1>
          <p className="text-fd-muted-foreground mt-6 max-w-lg text-pretty">
            Callbacks to write into any database. Your application issues its
            own JWTs, verified by anything that trusts a JWKS URL.
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
              params={{ _splat: "" }}
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
              code="bun add @auth-ts/server @auth-ts/client"
            />
          </div>
        </div>
        {/*
         * Bottom-aligned with the install command rather than floated beside
         * the heading, so both columns finish on the same line. The caption is
         * what keeps that reading as a decision — without a top edge the panel
         * looks dropped into the whitespace.
         */}
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

function Features() {
  return (
    <section className="border-fd-border border-b">
      <div className="mx-auto grid max-w-5xl gap-x-10 gap-y-9 px-6 py-16 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, index) => (
          <div key={feature.title} className="border-fd-border border-t pt-4">
            <span className="text-fd-primary font-mono text-xs">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h2 className="mt-2 font-medium">{feature.title}</h2>
            <p className="text-fd-muted-foreground mt-1.5 text-sm text-pretty">
              {feature.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Snippets() {
  return (
    <section className="border-fd-border border-b">
      {/*
       * `grid-cols-1` and `min-w-0` are both load-bearing. Without an explicit
       * column the implicit one sizes to its content, and a grid item's default
       * `min-width: auto` stops it shrinking below its longest unbroken line —
       * so a wide code sample widens the page instead of scrolling in place.
       */}
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-6 py-16 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <h2 className="font-mono text-sm">
            <span className="text-fd-primary">01</span> On the server
          </h2>
          <p className="text-fd-muted-foreground text-sm text-pretty">
            Write the callbacks, mount <code>authServer.handler</code> once at{" "}
            <code>/api/auth/*</code>, and point your database at the JWKS URL.
          </p>
          <DynamicCodeBlock lang="ts" code={SERVER_SNIPPET} />
        </div>
        <div className="min-w-0 space-y-3">
          <h2 className="font-mono text-sm">
            <span className="text-fd-primary">02</span> In the browser
          </h2>
          <p className="text-fd-muted-foreground text-sm text-pretty">
            Zero runtime dependencies. The access token lives in memory only,
            and is refreshed from an httpOnly cookie.
          </p>
          <DynamicCodeBlock lang="ts" code={CLIENT_SNIPPET} />
        </div>
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-6 px-6 py-16">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Five steps to a signed token
        </h2>
        <p className="text-fd-muted-foreground mt-2 max-w-md text-pretty">
          Install, generate a key, write the callbacks, mount one route, and
          point your database at it.
        </p>
      </div>
      <Link
        to="/docs/$"
        params={{ _splat: "" }}
        className="bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
      >
        Read the introduction
      </Link>
    </section>
  )
}
