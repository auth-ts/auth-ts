# Roadmap

What is deliberately not in v1, what is built but unproven, and what is someone
else's job. Nothing here is a bug; the bugs go in issues.

Four lists, because they need different decisions from you:

1. **[Your checklist](#your-checklist)** — everything that needs a human, in order.
2. **[Before v0.1.0 is real](#before-v010-is-real)** — the detail behind the checklist.
3. **[Deferred features](#deferred-features)** — wanted, scoped, not yet.
4. **[Not building](#not-building)** — declined on purpose, with the reason.

---

## Your checklist

Everything that needs you rather than more code. Roughly in the order it wants
doing; nothing here is blocked on anything in the later sections.

### Before merging

- [ ] **Review the amendments table** at the end of the plan file. Fifteen places
      this deviates from the original brief, each with its reasoning. Several were
      your calls made mid-build, so they are worth confirming rather than
      discovering later.
- [ ] **Open the pull request:**
      https://github.com/auth-ts/auth-ts/pull/new/feat/initial-build

### Prove OAuth against a live provider

GitHub is in real use. Google is the part with no real-world evidence behind it.

- [x] Register a **GitHub OAuth app**; callback
      `<origin>/api/auth/callback/github`. Done 2026-08-22 — the callback URL
      must include the provider segment; GitHub rejects the bare `/callback`.
- [ ] Register a **Google OAuth client**; callback
      `<origin>/api/auth/callback/google`.
- [ ] Put the four credentials in the demo's `.env`. (GitHub's two are in.)
- [x] **GitHub** — in use. Sign-in from a guest session converts the guest in
      place with name and avatar.
- [ ] **Google** — run it through sign in, connect from the account page,
      disconnect, and sign in again to confirm the stable-id match holds.
- [ ] **Connected accounts, live.** Provider tokens are stored encrypted and
      `getProviderToken` refreshes them, but no real provider has issued a
      refresh token to this code yet. Prove it with Google and
      `offlineAccess: true`: connect, wait past the hour, call the API again,
      then revoke the app at Google and confirm the next call clears the row and
      answers `providerReconnectRequired`. GitHub's refresh path needs a GitHub
      App with expiring tokens — a classic OAuth App never exercises it.

### The JWKS gist, if you keep using one for local development

- [ ] **Use the unpinned raw URL.** The one you shared is pinned to a commit SHA,
      so editing the gist will not change what Neon fetches:
      `https://gist.githubusercontent.com/daveycodez/93e780d7a7745317f3a65e7ceca93111/raw/auth-ts-jwks.json`
- [ ] Upload `public/jwks.json` to the gist again whenever you run
      `bun x @auth-ts/cli keygen` — it is a copy of the file, not a mirror.
- [ ] **Deployed, skip the gist entirely** and point Neon at
      `https://<your domain>/jwks.json`, the same file served by the app.
- [ ] Treat the current key as a **development key**. Generate a separate one for
      any deployed environment.

### Neon, for a deployed environment

- [ ] **Set the Data API's allowed origins** to your own domain. Worth doing,
      but know the limit: origins are browser-enforced, so they stop another
      site's JavaScript, not a leaked token replayed from curl. Row-level
      security and the ten-minute token lifetime are what contain that.
- [ ] Confirm the auth tables are still unreachable after any schema change:
      `set local role authenticated; select count(*) from users;` must return 0.
- [ ] Register the deployed origin's callback URL with each OAuth provider. The
      redirect URI is derived per request, so nothing is configured on this side
      — but the provider only redirects to a URI listed in its own console.
- [ ] Confirm a client IP is being derived — sign in and check `session.ipAddress`
      is set. Nothing to configure where the platform overwrites
      `x-forwarded-for`; behind an appending proxy, set `ipAddress.trustedProxies`
      or point `ipAddress.headers` at the header the edge controls.

### Publish the packages

Releases run from the Actions tab (Actions → Release → Run workflow), never from
a laptop. The workflow verifies, versions with `nx release`, pushes the tag and
GitHub Release, then publishes to npm with trusted publishing (OIDC). There is no
long-lived npm token once the first release is out.

- [ ] Confirm the **`@auth-ts` npm scope** and the **`auth-ts` GitHub
      organisation** are yours.
- [ ] Run **Release** with `dry-run` on and `first-release` on. Read the bump
      and changelog it prints.
- [ ] **Bootstrap the first publish.** npm cannot attach a trusted publisher to
      a package that does not exist yet, so `0.1.0` needs a token once. Create
      a granular access token scoped to the `@auth-ts` packages with the
      shortest lifetime npm allows, add it as the `NPM_TOKEN` repository
      secret, and run **Release** with `dry-run` off and `first-release` on.
- [ ] **Switch to trusted publishing.** On npmjs.com, for each of
      `@auth-ts/server`, `@auth-ts/client`, and `@auth-ts/cli`: package →
      Settings → Trusted
      publishing → GitHub Actions, owner `auth-ts`, repository `auth-ts`,
      workflow `release.yml`, environment `npm`, allowed action `npm publish`.
      Then delete the `NPM_TOKEN` secret and revoke the token. Every later
      release authenticates with OIDC; the workflow warns if the secret is
      still present.

### Deploy the docs

- [ ] Create the **Cloudflare Pages** project. Build `bun run build`, output
      `dist/client`, root `apps/docs`.
- [ ] Point `authts.dev` at it.
- [ ] **Configure the `authts.com → authts.dev` redirect in Cloudflare itself**,
      as a Redirect Rule (Rules → Redirect Rules) on the `authts.com` zone,
      preserving the path — source `authts.com/*`, target
      `https://authts.dev/${1}`, 301. It cannot live in `_redirects`: Pages
      lists domain-level redirects as unsupported there, so a rule written that
      way is silently ignored rather than rejected.

### If you deploy the demo publicly

- [ ] **Swap the console email transport for a real provider.** It currently logs
      codes to the server console, which is fine locally and a security hole in
      public — anyone who can read your logs can sign in as anyone. The sender is
      one function in `src/auth-server.ts`; a Resend call is about four lines.

### Nx Cloud

- [ ] Its setup rewrote `nx.json` in a formatting style Biome rejects and dropped
      the trailing newline. Reformatted here — worth knowing it will happen again
      the next time that tool writes to the file.

---

## Before v0.1.0 is real

### OAuth has completed one live round trip, with GitHub

The flows are covered end to end, including the four scenarios that are account
takeovers if they regress: state mismatch, unverified email, non-primary email,
and a connect callback arriving without the session that started it. Those tests
fake the network beneath the real provider modules. On 2026-08-22 GitHub
sign-in ran live for the first time: the token exchange, `/user`, and
`/user/emails` all answered in the shapes the module expects, and a guest
session converted in place with email, name, and avatar.

Still unproven against a live provider: Google entirely, and for GitHub the
connect, disconnect, and repeat-sign-in paths. The first live run also surfaced
a database the schema had drifted from (a plain index where linking an
identity needs a unique one) — the kind of thing only a real round trip catches.

To close it: register a Google client, point the callback at
`<origin>/api/auth/callback/google`, and run both providers through connect and
disconnect against the demo.

### Publishing

`nx release --dry-run` produces the changelog correctly and both packages version
together from `0.1.0`. Nothing has been published. The **Release** workflow is
written and the `npm` GitHub environment exists (deployments restricted to
`main`); neither has run for real. The first run needs the one-time `NPM_TOKEN`
bootstrap described under *Publish the packages*, after which trusted
publishing takes over and no npm token remains anywhere.

Check the `@auth-ts` npm scope and the `auth-ts` GitHub organisation actually
exist and are yours before the first release.

### Deploying the docs

`wrangler.jsonc` is written; no Cloudflare Pages project exists. Build command
`bun run build`, output directory `dist/client`.

The `authts.com → authts.dev` redirect is **not** configured anywhere. It has to
be a Cloudflare Redirect Rule on the `authts.com` zone — Pages `_redirects` does
not support domain-level rules, and writes one there are ignored without error.

### Things the reference application proves that a fresh deployment does not

The demo runs against a real Neon database with row-level security enforcing row
ownership — two users, each seeing only their own rows, with `userId` derived
from the verified token rather than sent by the client. A new deployment still
has to do the things that are easy to skip:

- **Set `ipAddress.trustedProxies` to your proxy count.** IP-keyed rate limits
  derive nothing until you declare your topology — the forwarded header is
  client-controlled, so the real address is read from a fixed offset from the
  right rather than the spoofable leftmost entry, and only after validating it
  as an IP. Default zero means no IP limiting (per-identifier limits still hold).
- **Check what your database grants by default.** Neon gives the `authenticated`
  role full access to everything in `public` when the Data API is enabled, so the
  auth tables have to be explicitly protected. The demo enables row-level
  security with no policy on them, which denies every role except the owner.
- **Set the Data API's allowed origins.** Browser-enforced only: it stops
  another site's JavaScript using your visitors' credentials, not a leaked token
  replayed from a script.
- **Replace the console email transport.** It prints codes to the server console,
  which is a sign-in-as-anyone hole the moment those logs are readable.

### A conformance suite for the four functions

**Shipped.** `authDBChecks` in `@auth-ts/server/testing` is the contract as a
list of checks, each `{ name, run(db) }`, throwing on failure so it fits any
runner without dragging a test framework into the package's dependencies:

```ts
import { authDBChecks } from "@auth-ts/server/testing"

for (const check of authDBChecks) {
  it(check.name, () => check.run(authDB)) // your four functions, your database
}
```

Every check tags its rows and cleans up after itself, so it runs against a real
database — which is the point, since the two things most likely to be wrong are
whether the unique constraints exist and whether `delete` returns what it
removed, and neither is observable against a mock. It deviates from the earlier
`testAuthDB(() => authDB)` sketch for that reason: a function that registers
tests has to import a runner.

Verified against the reference application's Neon database, all eleven checks
passing, and the library's own suite runs them against `createMemoryDb` plus a
set of deliberately broken stores — a `delete` that returns nothing, a `where`
that matches on any column rather than all of them, a `select` that ignores
`limit`, a `delete` that ignores ranges — so the checks are known to fail when
the contract is broken, not merely to pass when it is not.

They also run in CI, from the reference application, against its own
`src/lib/auth-db.ts` — the file people copy — so it stays proven rather than
believed. No connection string: PGlite is Postgres 18 compiled to WebAssembly,
running in the test process, and the schema is real enough to matter because the
DDL is generated from `schema.ts` rather than written out again. The unique
constraints, the cascades, and `uuidv7()` are all the deployed ones.

Two things that setup does not cover, worth saying rather than implying:

- **The driver.** Tests reach Postgres through PGlite; production goes through
  Neon's HTTP driver. Drizzle emits the same SQL for both, so this proves the
  schema and the four functions, not the transport.
- **Row-level security.** The auth tables are created without the policies, and
  `todos` is left out entirely. RLS is what the Data API enforces against
  application queries, and nothing in `AuthDB` depends on it.

One limit is stated in the docs and worth repeating: a duplicate-insert check
proves a constraint exists by inserting twice in sequence. The failure it
prevents only shows under a race, which no test stages reliably. The constraint
is the fix; the check is evidence that you have one.

---

## Deferred features

### Email and phone number changes

Changing an identifier re-keys the account, because every sign-in resolves
through it. That makes it a ceremony — a code verified at the **new** address,
and a notification to the old one — not a field on `PATCH /user`, which is why
that endpoint rejects `email` and `phoneNumber` today.

### Magic links

Codes were chosen for v1 because they survive the common case where the link
opens in a different browser than the one you started in. Links need one-time
URLs, a different email template, and their own expiry semantics.

### Custom OIDC providers

Two halves of very different sizes.

**Consuming** a custom issuer — `providers.custom: { issuer, clientId, clientSecret }`,
discovery-driven code flow, `sub` as the provider account id — is configuration
only. The generic `:provider` routes guarantee no new endpoints and no breaking
change, so this is the cheap half and the obvious next provider feature.

**Being** an identity provider is its own section below.

### Being an identity provider

An authorize endpoint, a code grant, and a client registry — a v2-scale
subsystem, and one feature answering three asks at once: single sign-on across
your own domains, third-party "sign in with us", and the cross-domain
deployment the *Known constraints* section says a reverse proxy is the fix for
today.

The shape is settled even though none of it is built. Each domain keeps its own
first-party session; the centre is reached by top-level redirect, never by a
shared cookie. That is what makes it work where cookies cannot: the browser
travels to the auth origin, which reads its **own** `HttpOnly` cookie, and
bounces back with a code the application exchanges for tokens. OpenAuth
implements exactly this shape, `httpOnly` session cookie included.

The session core needs nothing new — `resolveSession` is what `/authorize`
would authenticate against, and `signToken` already accepts a caller-supplied
`aud` and `iss` for client-scoped tokens. What it needs is storage for clients,
authorization codes, and grants, and those belong in a contract of their own
rather than widening the five tables every consumer already implements.

Until then, the centre can be any existing provider.

### Revoking a grant at the provider on disconnect

Disconnecting deletes the identity and the tokens with it, which ends this
side's access. The grant itself stays listed on the user's Google or GitHub
account until they remove it there. Calling each provider's revocation endpoint
would close that, and needs a decision about what a failed revocation means —
refusing the disconnect leaves a row nobody wanted, and ignoring it makes the
call decorative.

### Identifier linking for guests

A guest can already gain recoverability by connecting an OAuth provider. Adding
an email or phone number to a guest account without a full sign-in is a separate
verification ceremony.

### BroadcastChannel for cross-tab sync

Cross-tab sync currently rides the `localStorage` `storage` event: a sign-out in
one tab clears the user and the access token in the others, with no fetch, so N
tabs cannot stampede the refresh endpoint. It degrades silently where storage is
unavailable — private-mode Safari, for instance.

`BroadcastChannel` is the better transport: structured messages and no storage
dependency. It is a strict improvement, just not a necessary one.

### Single-session-per-user enforcement

"Only one device at a time" is a policy some products want. Reading and deleting
`sessions` rows already gives you the pieces; the missing part is a config
flag that revokes on sign-in.

### Lifecycle webhooks

Mostly unnecessary by construction: **your four functions are the hooks.** Your
`insert` knows when a `users` row is created, which is where the welcome email
belongs. A webhook layer would be a second, worse copy of information you
already have.

### Native applications

The token model is settled and shipped: the refresh token travels only as a
cookie, and a runtime with no cookie jar passes `cookieStorage` to
`createAuthClient` — the client keeps what the server sets in the platform's
keychain and sends it back as the `Cookie` header. No second credential, no
server change. What remains is the OAuth half:

- **Deep-link redirects.** `validateRedirect` and the origin check admit only
  same-origin paths and http(s) origins. A native flow needs `myapp://…` as an
  allowed post-OAuth redirect and as an acceptable (or absent) `Origin`, behind
  a new option naming the trusted schemes. `signInWithProvider` and `connect` on the client
  navigate with `location.assign`; native needs the URL to hand to the system
  browser instead.
- **ID-token sign-in.** Sign in with Apple and Google on a device is the native
  SDK producing an ID token, not a redirect. A `POST /sign-in/$provider` body
  carrying `idToken` (and the nonce it was minted with), verified against the
  provider's published keys and resolved through the same identity path the
  callback uses. App Store review effectively requires the Apple one.

Neither is built until there is an Expo example to test it against — see
**Examples** below.

### Examples

One exists, and it is the reference application. The others each prove a
different edge of the design and should be built in roughly this order:

- **Next.js.** Server components and route handlers exchanging the cookie with
  `authServer.getToken({ headers })` once per render and spending the token, and
  the cookie-path trap.
- **Supabase with row-level security.** The same data-plane story as Neon, with
  `auth.jwt()` policies instead of `auth.session()`, and the JWKS published
  where Supabase's verifier can find it. Proves the token is portable.
- **Expo.** `cookieStorage` over `expo-secure-store`, and the test bed for
  deep-link OAuth and ID-token sign-in above. Nothing native ships as "done"
  until this runs on a device.
- **Solid.js 2.0 with SolidStart.** A non-React client consumer, so nothing in
  the client turns out to assume React's render model.

---

## Not building

Declining these is a design position, not a backlog.

### Database adapter packages — ever

Adapters are a standing promise to track someone else's schema conventions, and
they always leak: your table has an extra required column, a different id type,
or a naming convention the adapter cannot express. Four generic table functions
are the same code an adapter would generate, except you can read them and they
are already written against your own tables.

**The database contract is the product.** That is where the semver discipline
goes, and why `authDBChecks` ships beside it: a contract you are asked to
implement yourself owes you a way to check your work.

### Rotating the refresh token on every use

Refresh tokens themselves are core to the design — stable per session, revoked
by deleting the session row. Only the rotate-on-every-refresh pattern is excluded.

The cookie is `HttpOnly`, host-only, and never crosses an origin, so rotation
mostly defends against theft requiring a compromise that defeats rotation anyway.
What it reliably causes is a race between concurrent tabs, where the second
presents a token the first has already spent — and a race the server-rendered
case cannot even resolve, since a rotated token has to be written back on a
response and frameworks do not always permit that where the session is read.

If you store the refresh token outside an `HttpOnly` cookie, rotation and reuse
detection become mandatory — which is precisely why that mode is unsupported.
GoTrue is the worked example of the other path: rotation on by default, a
parent/revoked chain per token, and a configurable reuse interval to survive
the concurrent case. That is a coherent design, and the opposite one from this.
The combination to avoid is half of each — a token a script can read that never
rotates.

### Password authentication

A different threat model with its own permanent obligations: breach lists, reset
flows, rotation policies, and slow hashing. The library would become mostly
password machinery.

### Organisations, role-based access control, and two-factor

`type` is carried into the JWT so your policies can read it, and `admin` is
vocabulary the library never assigns — promoting someone is your own SQL. Beyond
that, authorization is your schema's job. Two-factor is a real feature and a real
subsystem; it is not a v1 omission that gets quietly patched in.

### A hosted service

There is no company. That is a feature.

### A server-side "optimistic" user

The client's user object is a render hint — it decides whether to show a name in
the corner. On the server the same object would be an authorization decision made
from a cache, which is a 1am phone call waiting to happen. Server-side code calls
`getToken` and gets the truth.

---

## Known constraints worth remembering

**TypeScript 7 ships no compiler API.** The native package exports `version` and
nothing else, so anything reaching for `ts.createProgram` — most codemods, the
public-API doc checks — has to get that API from somewhere else. Two places
provide it: `@typescript/typescript6` publishes the 6.x API for side-by-side
use, and `ts-morph` vendors its own copy.

The workspace needs neither. It is on 7.0.2 everywhere, including `apps/docs`:
the type tables come from `fumadocs-typescript`, which reaches the compiler
through `ts-morph`'s bundled TypeScript rather than through whatever the
workspace has installed. `apps/docs` pinned 5.9.3 for a while on the assumption
that the generator needed it; removing the pin changed no output, and the doc
checks in `tools/testing` read source text precisely so they need no compiler
at all.

**Revocation latency is the access-token lifetime.** The database checks a
signature and an expiry; it does not call you. "Signed out everywhere" means
within `jwt.ttl` — ten minutes by default. Shortening it trades refresh traffic
for revocation speed.

**Cross-domain deployment is deliberately limited.** Same origin needs no
configuration. A different subdomain of the same registrable domain works with
`baseURL`, `cors.origin`, and `cookie.hintDomain` — the last one names the
domain the readable hint is scoped to. It is stated rather than derived: working
it out from the request means guessing where the registrable domain ends, and a
guess landing on a public suffix like `vercel.app` is refused by the browser
rather than by this library, so the hint silently never arrives.

A genuinely foreign domain never receives the cookie at all, because
`SameSite=Lax` does not send cross-site and `SameSite=None` reopens CSRF while
dying to cookie partitioning. The fix is a reverse proxy that puts the auth
mount back on the application's own origin — or, eventually, the identity
provider below, which solves it with a redirect rather than a shared cookie.
