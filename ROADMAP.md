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

The one part of the build with no real-world evidence behind it.

- [ ] Register a **GitHub OAuth app**; callback
      `<AUTH_BASE_URL>/api/auth/callback/github`.
- [ ] Register a **Google OAuth client**; callback
      `<AUTH_BASE_URL>/api/auth/callback/google`.
- [ ] Put the four credentials in the demo's `.env`.
- [ ] Run each provider through: sign in, connect from the account page,
      disconnect, and sign in again to confirm the stable-id match holds.

### The JWKS gist, if you keep using one

- [ ] **Use the unpinned raw URL.** The one you shared is pinned to a commit SHA,
      so editing the gist will not change what Neon fetches:
      `https://gist.githubusercontent.com/daveycodez/93e780d7a7745317f3a65e7ceca93111/raw/auth-ts-jwks.json`
- [ ] Re-run `bun run jwks` and update the gist whenever the signing key changes —
      it is a snapshot, not a mirror.
- [ ] **In production, skip the gist entirely** and point Neon at
      `<baseURL>/api/auth/jwks.json`, so key rotation needs no second step.
- [ ] Treat the current key as a **development key**. Generate a separate one for
      any deployed environment.

### Neon, for a deployed environment

- [ ] **Lock the Data API's allowed origins** to your own domain. Empty means
      anyone on the internet can query it with a stolen token.
- [ ] Confirm the auth tables are still unreachable after any schema change:
      `set local role authenticated; select count(*) from users;` must return 0.
- [ ] Set `AUTH_BASE_URL` to the deployed origin — it is `http://localhost:5173`
      today, and OAuth redirect URIs are built from it.

### Publish the packages

- [ ] Confirm the **`@auth-ts` npm scope** and the **`auth-ts` GitHub
      organisation** are yours.
- [ ] Add `NPM_TOKEN` to the repository secrets.
- [ ] Tag `v0.1.0`. The release workflow publishes both packages with provenance.

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

### OAuth has never talked to GitHub or Google

The flows are covered end to end, including the four scenarios that are account
takeovers if they regress: state mismatch, unverified email, non-primary email,
and a connect callback arriving without the session that started it. But those
tests fake the network beneath the real provider modules — **no live provider has
ever completed a round trip.**

What could still be wrong is exactly what a fake cannot catch: a changed response
shape, a scope that no longer returns what it used to, a redirect URI mismatch
the provider reports differently than expected.

To close it: register a GitHub app and a Google client, point the callback at
`<AUTH_BASE_URL>/api/auth/callback/<provider>`, and run both flows plus a connect
and a disconnect against the demo.

### Publishing

`nx release --dry-run` produces the changelog correctly and both packages version
together from `0.1.0`. Nothing has been published. It needs `NPM_TOKEN` in the
repository secrets and a `v0.1.0` tag.

Check the `@auth-ts` npm scope and the `auth-ts` GitHub organisation actually
exist and are yours before tagging.

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

- **Confirm which header your platform sets for the client IP.** If neither
  `X-Forwarded-For` nor `X-Real-IP` arrives, every visitor shares one rate-limit
  bucket, which is a denial of service on your own sign-in page.
- **Check what your database grants by default.** Neon gives the `authenticated`
  role full access to everything in `public` when the Data API is enabled, so the
  auth tables have to be explicitly protected. The demo enables row-level
  security with no policy on them, which denies every role except the owner.
- **Lock the Data API's allowed origins.** Empty means the whole internet can
  query it with a stolen token.
- **Replace the console email transport.** It prints codes to the server console,
  which is a sign-in-as-anyone hole the moment those logs are readable.

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

**Being** an identity provider — an authorize endpoint, a code grant, a client
registry — is a v2-scale subsystem. Worth naming because it is the real answer to
multi-domain single sign-on: each domain keeps its own first-party session and
the central domain is an IdP reached by top-level redirect, never by shared
cookies. Until then, the centre can be any existing provider.

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

"Only one device at a time" is a policy some products want. The devices list and
`DELETE /sessions/:id` already give you the pieces; the missing part is a config
flag that revokes on sign-in.

### Lifecycle webhooks

Mostly unnecessary by construction: **the callbacks are the hooks.** Your
`upsertUser` knows when it inserts, which is where the welcome email belongs. A
webhook layer would be a second, worse copy of information you already have.

### Native application OAuth

Deep-link flows for iOS and Android. `mode: "token"` already exists for clients
with no cookie jar, so this is the redirect handling rather than the token model.

---

## Not building

Declining these is a design position, not a backlog.

### Database adapters — ever

Adapters are a standing promise to track someone else's schema conventions, and
they always leak: your table has an extra required column, a different id type, or
a naming convention the adapter cannot express. The nineteen callbacks are the
same code an adapter would generate, except you can read them and they are
already written against your own tables.

**The callback interface is the product.** That is where the semver discipline
goes.

### Rotating the refresh token on every use

Refresh tokens themselves are core to the design — stable per session, revoked
through `deleteSession`. Only the rotate-on-every-refresh pattern is excluded.

The cookie is `HttpOnly`, path-scoped, and never crosses an origin, so rotation
mostly defends against theft requiring a compromise that defeats rotation anyway.
What it reliably causes is a race between concurrent tabs, where the second
presents a token the first has already spent.

If you store the refresh token outside an `HttpOnly` cookie, rotation and reuse
detection become mandatory — which is precisely why that mode is unsupported.

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
`getSession` or `getToken` and gets the truth.

---

## Known constraints worth remembering

**TypeScript 7 ships no compiler API.** The native package exports `version` and
nothing else. Anything needing `ts.createProgram` — the documentation type-table
generator, most codemods — needs TypeScript 5.x pinned for that package alone.
`apps/docs` does exactly this; the rest of the workspace builds on 7.

**Attempt counting on magic codes is not atomic.** Verification reads the row,
then writes `attempts + 1`, so two simultaneous wrong guesses can undercount by
one. Accepted deliberately: the HMAC, the ten-minute lifetime, and the per-IP
verify limit are the real throttles, and making it atomic would mean a new
callback every consumer has to implement correctly.

**Revocation latency is the access-token lifetime.** The database checks a
signature and an expiry; it does not call you. "Signed out everywhere" means
within `jwt.ttl` — ten minutes by default. Shortening it trades refresh traffic
for revocation speed.

**Cross-domain deployment is deliberately limited.** Same origin needs no
configuration. A different subdomain of the same registrable domain works with
`baseURL` and `cors.origin`. A genuinely foreign domain never receives the
cookie, because `SameSite=Lax` does not send cross-site and `SameSite=None`
reopens CSRF while dying to cookie partitioning. The fix is a reverse proxy that
puts the auth mount back on the application's own origin.
