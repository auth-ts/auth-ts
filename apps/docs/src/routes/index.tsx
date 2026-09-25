import { createFileRoute, Link } from "@tanstack/react-router"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import {
  ArrowRight,
  Database,
  Globe,
  KeyRound,
  MonitorSmartphone,
  Scale,
  ShieldCheck
} from "lucide-react"
import { Fragment } from "react"
import { GitHubIcon } from "~/components/github-icon"
import { Logo } from "~/components/logo"
import { SiteHeader } from "~/components/site-header"
import { REPO_URL } from "~/lib/layout.shared"
import configureSource from "../../content/snippets/home/configure.ts?raw"
import routeSource from "../../content/snippets/home/route.ts?raw"
import signInSource from "../../content/snippets/home/sign-in.ts?raw"

export const Route = createFileRoute("/")({ component: LandingPage })

const CLAIMS = ["No limits", "No service", "No company"]

const SPECS = [
  ["Runtime", "Node 20+, Workers, Deno, Bun"],
  ["Algorithms", "ES256, RS256"],
  ["Dependencies", "jose"],
  ["License", "Apache-2.0"]
]

const CUT = "// ---cut---\n"

// Hides each snippet's typecheck-only header.
function shown(source: string) {
  return source.slice(source.indexOf(CUT) + CUT.length).trim()
}

const STEPS = [
  {
    title: "Configure",
    body: "One file on your server.",
    file: "lib/auth.ts",
    code: shown(configureSource)
  },
  {
    title: "Mount",
    body: "One catch-all route, in any framework.",
    file: "app/api/auth/[...all]/route.ts",
    code: shown(routeSource)
  },
  {
    title: "Sign in",
    body: "From the browser, with no UI to adopt.",
    file: "components/sign-in.tsx",
    code: shown(signInSource)
  }
]

const TOKEN = `{
  "sub": "0199a3c4-7e1b-7c3a-9f2e-4b8d1e6a2c10",
  "role": "authenticated",
  "type": "user",    // "guest", "user" or "admin"
  "amr": ["otp"],    // how they signed in
  "exp": 1771203600  // one hour, by default
}`

const VERIFIERS = [
  ["Your own routes", "data/server-routes"],
  ["Neon", "data/neon"],
  ["Supabase", "data/supabase"],
  ["Any JWKS library", "data/jwks"]
]

const FEATURES = [
  {
    icon: Database,
    title: "Your tables",
    body: "Six tables in your own database, reached through four functions. No adapters."
  },
  {
    icon: KeyRound,
    title: "Every common sign-in",
    body: "Email and SMS codes, GitHub, Google, and guests who keep their data when they sign in."
  },
  {
    icon: MonitorSmartphone,
    title: "Sessions and devices",
    body: "A session per device, and switching between accounts in one browser."
  },
  {
    icon: ShieldCheck,
    title: "Standard keys",
    body: "ES256 or RS256, published at /jwks.json for anything to check."
  },
  {
    icon: Globe,
    title: "Runs anywhere",
    body: "Node 20+, Workers, Deno and Bun. One dependency: jose."
  },
  {
    icon: Scale,
    title: "Free forever",
    body: "Apache-2.0. No hosted service, no per‑user pricing."
  }
]

const FRAME =
  "border-fd-border mx-auto w-full max-w-(--fd-layout-width) md:border-x"

function LandingPage() {
  return (
    <HomeLayout
      nav={{ component: <SiteHeader /> }}
      className="[--fd-layout-width:97rem]"
    >
      <Hero />
      <div className={FRAME}>
        <Steps />
        <Token />
        <Features />
        <Closing />
        <Footer />
      </div>
    </HomeLayout>
  )
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
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
      <div
        className={`${FRAME} grid grid-cols-1 gap-10 px-4 py-10 md:gap-12 md:px-6 md:py-12 lg:grid-cols-2 lg:items-end`}
      >
        <div className="min-w-0">
          <h1 className="flex flex-col gap-4">
            <span className="flex items-center gap-2 font-mono text-4xl font-semibold tracking-tighter md:gap-3 md:text-6xl">
              <Logo className="text-fd-primary size-11 md:size-18" />
              auth.ts
            </span>
            <span className="max-w-lg text-2xl font-medium tracking-tight text-balance md:text-3xl lg:max-w-none">
              <span className="before:bg-fd-primary relative whitespace-nowrap before:absolute before:inset-x-0 before:bottom-[-0.015em] before:h-[max(3px,0.07em)] before:rounded-full before:content-['']">
                Free forever
              </span>{" "}
              auth in TypeScript.
            </span>
          </h1>
          <p className="text-fd-muted-foreground mt-6 max-w-lg text-pretty lg:max-w-none">
            Sign-in, sessions and JWTs for any TypeScript app.
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
          <div className="mt-8 max-w-md md:max-w-none">
            <DynamicCodeBlock
              lang="bash"
              code={`npm install @auth-ts/core
npx @auth-ts/cli keygen`}
              codeblock={{ className: "shadow-none" }}
            />
          </div>
        </div>
        <div>
          <p className="text-fd-muted-foreground mb-3 font-mono text-xs tracking-wider uppercase">
            Package
          </p>
          <dl className="text-sm md:grid md:grid-cols-2 md:gap-x-6 lg:block">
            {SPECS.map(([term, value]) => (
              <div
                key={term}
                className="border-fd-border flex items-baseline justify-between gap-6 border-b py-2.5 first:border-t md:nth-2:border-t lg:nth-2:border-t-0"
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

function SectionHeading({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-6 md:px-6 md:py-8">
      <h2 className="text-2xl font-semibold tracking-tight text-balance">
        {title}
      </h2>
      <p className="text-fd-muted-foreground mt-3 max-w-xl text-pretty">
        {body}
      </p>
    </div>
  )
}

function Steps() {
  return (
    <section className="border-fd-border border-t">
      <SectionHeading
        title="Three steps to a signed-in user"
        body="The quickstart walks through each one, with the database tables."
      />
      <ol className="border-fd-border divide-fd-border grid divide-y border-t lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex min-w-0 flex-col gap-1 p-4 md:p-6 md:max-lg:grid md:max-lg:grid-cols-2 md:max-lg:grid-rows-[auto_auto_1fr] md:max-lg:gap-x-4"
          >
            <p className="text-fd-primary font-mono text-xs">0{index + 1}</p>
            <h3 className="font-medium">{step.title}</h3>
            <p className="text-fd-muted-foreground mb-3 text-sm">{step.body}</p>
            <DynamicCodeBlock
              lang={step.file.endsWith("x") ? "tsx" : "ts"}
              code={step.code}
              codeblock={{
                title: step.file,
                className:
                  "my-0 flex flex-1 flex-col shadow-none [&_pre]:text-xs [&>div:last-child]:flex-1 md:max-lg:col-start-2 md:max-lg:row-span-3 md:max-lg:row-start-1"
              }}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

function Token() {
  return (
    <section className="border-fd-border divide-fd-border grid divide-y border-t lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      <div className="px-4 py-6 md:px-6 md:py-8">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          A JWT anything can verify
        </h2>
        <p className="text-fd-muted-foreground mt-3 max-w-lg text-pretty">
          Your server signs a short-lived token with your own key. Anything that
          reads a JWKS can check it, with no call back to auth.
        </p>
        <ul className="mt-8 flex flex-col">
          {VERIFIERS.map(([text, splat]) => (
            <li key={text} className="border-fd-border border-b first:border-t">
              <Link
                to="/docs/$"
                params={{ _splat: splat }}
                className="group hover:text-fd-primary flex items-center justify-between py-3 text-sm font-medium transition-colors"
              >
                {text}
                <ArrowRight className="text-fd-muted-foreground group-hover:text-fd-primary size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-w-0 items-center p-4 md:p-6">
        <DynamicCodeBlock
          lang="jsonc"
          code={TOKEN}
          codeblock={{
            title: "Access token",
            className: "my-0 w-full shadow-none"
          }}
        />
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="border-fd-border border-t">
      <SectionHeading
        title="Everything a sign-in needs"
        body="And nothing you have to host, pay for or migrate away from."
      />
      <ul className="border-fd-border bg-fd-border grid gap-px border-t sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="bg-fd-background p-4 md:p-6">
            <Icon className="text-fd-primary size-5" />
            <h3 className="mt-4 font-medium">{title}</h3>
            <p className="text-fd-muted-foreground mt-1.5 text-sm text-pretty">
              {body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Closing() {
  return (
    <section className="border-fd-border flex flex-col items-center border-t px-4 py-10 text-center md:px-6 md:py-12">
      <h2 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
        Add sign-in to your app
      </h2>
      <p className="text-fd-muted-foreground mt-3 max-w-md text-pretty">
        From an empty folder to a signed-in user, one step at a time.
      </p>
      <Link
        to="/docs/$"
        params={{ _splat: "quickstart" }}
        className="bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90 mt-8 inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
      >
        Read the quickstart
        <ArrowRight className="size-4" />
      </Link>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-fd-border flex flex-col items-center gap-4 border-t p-4 text-center text-sm md:flex-row md:justify-between md:gap-6 md:p-6 md:text-start">
      <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium">
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
        <a
          href="https://thecopenhagenbook.com"
          className="whitespace-nowrap underline"
        >
          The Copenhagen Book
        </a>
        .
      </p>
    </footer>
  )
}
