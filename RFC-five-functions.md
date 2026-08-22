# RFC: five functions

**Status:** implemented, 2026-08-22. Kept as the design record; where it and the
code disagree, the code is right. Read
[the AuthDB reference](apps/docs/content/docs/reference/auth-db.mdx) for the
shipped contract.

Four things landed differently from the draft below, decided while building it.
The title is the first of them: the contract is **four** functions — `select`,
`insert`, `update`, `delete` — plus an optional `cleanup`, not five.

1. **`orderBy` is `{ column: "asc" | "desc" }`**, Prisma's shape, with exactly
   one key — not `{ column, direction }`.
2. **Ids belong to the store.** There is no uuidv7 in core. Rows are inserted
   without an `id` and the store's own default names them; `insert` returns the
   stored row, which is how core learns it. `createAuthServer({ generateId })`
   is there for deployments that mint their own. Nothing in core assumes ids
   sort by time, so the "newest code" read orders by `expiresAt` and the devices
   list by `createdAt`.
3. **Cleanup is an optional `AuthDB.cleanup()`**, not a `createAuthServer`
   option and not a required `deleteExpired`. Implement it and core sweeps for
   you — awaited, throttled to once a minute per server, skipped on `GET`;
   leave it out and cleanup is yours. The interval is a constant, not a knob.
4. **`magicCodes` is `verificationCodes`**, and the row's write payload is
   `values` on both `insert` and `update` rather than `row` and `fields`.

**Scope:** replace the eighteen named `AuthDB` callbacks with five generic ones,
and replace the counter-based rate limiter with append-and-count.

The interface keeps its name. It is still `AuthDB`, still `db:` in
`createAuthServer`, still `createMemoryDb` in `/testing`.

---

## Why

The first live day against Neon produced two bugs, neither in the library:

1. `connections` had a plain index where `upsertConnection`'s `ON CONFLICT`
   needed a unique one.
2. A magic-code sign-in carries no `name` or `imageURL`; the contract says
   `undefined` means "leave alone"; Drizzle dropped both and
   `onConflictDoUpdate` threw `No values to set`. Every code verify in the demo
   failed.

Both are contract subtleties every consumer must rediscover, and the
conformance suite planned in the roadmap only catches the second. Meanwhile
`upsertRateLimit` — two `CASE` expressions and a raw `excluded."resetAt"` — is
the worst thing in the file people will copy, and it exists only because the
contract asks the store to decide "has the window passed?" inside one atomic
statement.

The generic-CRUD shape had been rejected (`ROADMAP.md`, "Database adapters —
ever") on three grounds: atomicity, the `where` language, and column naming.
Working through the rate limiter dissolved the first and shrank the second.

## The insight that unlocked it: append-and-count

A counter needs an atomic increment, which many stores lack and which a generic
`update(table, where, fields)` with literal values can never express. A **log of
attempts** needs only insert and select, which every store has.

- Each attempt inserts `{ key, expiresAt }` under a fresh id. Inserts never
  conflict, so nothing is read-modify-written and nothing can be lost.
- Core then selects `where key = …` with `limit: max + 1` and checks the length.
  It never needs the exact count, only "more than max exist", and the limit
  keeps an attacker from turning every request into a ten-thousand-row read.
- The window goes **in the key** — `${scope}:${id}:${windowStart}` — so the
  select is pure equality and expired windows are just old rows for the sweep.
- The per-code guess cap is the same thing keyed on `codeHash`, `expiresAt` =
  the code's expiry. Two calls, no atomic primitive.

What it costs, stated next to what it buys:

- **Bounded slack under a simultaneous burst.** An atomic counter is exact: the
  sixth concurrent guess reads `6` and is refused. Append-and-count: each
  request's select sees every insert committed before it runs, so N
  simultaneous requests can each read below the cap for the instant before the
  others land. Bounded by one burst's concurrency; the moment it settles, the
  rest of the window is refused and it cannot be repeated. For a six-digit code
  that is "perhaps 20 guesses instead of 5" — 2×10⁻⁵ instead of 5×10⁻⁶ per
  code per TTL. Say this in the docs; do not imply exactness.
- **Two round trips instead of one** on send-code, verify-code, guest sign-in.
  Low-frequency endpoints; refresh is not limited. Not worth optimising.
- **The sweep becomes load-bearing.** One row per attempt, so a flood writes a
  row per request until the window passes. `deleteExpired` already runs after
  every request; `cleanup: false` now means unbounded growth under attack.
  Consider making cleanup non-optional for this table. Requires indexes on
  `key` and `expiresAt`.
- **Upside nobody asked for:** the rows are a failed-sign-in log.

Adapter-based libraries hit exactly this wall: a rate-limit table behind a
generic adapter is read-then-write, and the eventual fix is a dedicated
"consume" hook that must check and increment in one operation — a carve-out
outside the adapter, because the adapter cannot express it. Append-and-count
gets a correct, store-backed, serverless-safe limiter out of the same generic
functions with no carve-out.

Rate limiting stays in the library, on by default, database-backed. Volume
windows can be turned off (`rateLimit: false`) for deployments that limit at
the edge — a Cloudflare rule or DO on `/send-code` and `/verify-code` — and the
docs should say that is the recommended production posture there. The per-code
guess cap is **not** rate limiting, it is what makes a six-digit code safe; it
has to be keyed on the code and run regardless, and the edge cannot do it.

## The contract

```ts
interface AuthDB<S extends AdditionalFieldsSchema = AdditionalFieldsSchema> {
  select<T extends Table>(input: {
    table: T
    where: Where<S, T>
    limit: number
    offset: number
    orderBy: { column: keyof Row<S, T>; direction: "asc" | "desc" }
  }): Promise<Row<S, T>[]>
  insert<T extends Table>(input: { table: T; row: Insert<S, T> }): Promise<Row<S, T>>
  update<T extends Table>(input: { table: T; where: Where<S, T>; fields: Partial<Row<S, T>> }): Promise<void>
  delete<T extends Table>(input: { table: T; where: Where<S, T> }): Promise<Row<S, T>[]>
  deleteExpired(): Promise<void>
}
```

- **Nothing on `select` is optional.** The implementer always receives
  `limit`, `offset`, and `orderBy`, so there is no `undefined` to branch on —
  one code path per store. Core fills the defaults at its own call sites:
  `offset: 0`, `orderBy: { column: "id", direction: "asc" }` (uuidv7 ids sort
  by insertion time, which is what makes `offset` stable). An unbounded read is
  a type error; every list core makes has a ceiling — the devices list, the
  connections list, the append-and-count check (`max + 1`), the single-row
  lookups (`1`). `offset` and `orderBy` are in the contract from day one so
  that paging (a long devices list, an admin view) never needs a contract
  change. `orderBy` is one column and a direction — enough for paging and for
  "newest", and the smallest thing every store can express.
- **`update` returns `void`.** Core always holds the row it is updating — it
  just selected it, or it came from the resolved session — so the result is
  `{ ...existing, ...fields }` composed in core, and `AuthUser` has no
  database-generated columns the store would know better. Returning rows would
  only buy detection of a row deleted between the select and the update (the
  following session insert fails on the FK anyway) and would cost one extra
  call on stores that do not return representations. `delete` returns rows
  because there the returned row *is* the proof (single-use codes); the
  asymmetry is deliberate.
- **Additional fields** ride flat on `users` exactly as today: `AuthDB<S>` is
  generic over the declared schema and `Tables<S>` makes `users` an
  `AuthUser<S>`, so `Row<S, "users">`, `Insert<S, "users">` and
  `Where<S, "users">` all carry them. Type plumbing, not a design change; the
  exported `SelectInput<S>`-style unions take the same parameter.

- **`where` is equality only** — a plain object of column/value pairs, all of
  which must match. No operators. This is the property that makes the four
  functions trivial on Drizzle, raw SQL, PostgREST / the Data API, InstantDB,
  Firestore, or a KV with secondary indexes alike. One operator is the thin end
  of a query language.
- **`deleteExpired` stays named** rather than teaching `where` an `lt`. It is
  maintenance — one `delete where expiresAt < now()` per table — and "your
  database knows the time" was a deliberate choice worth keeping.
- **`orderBy` is used sparingly.** Core needs it once: the newest code for an
  identifier (`orderBy: { column: "id", direction: "desc" }, limit: 1` —
  uuidv7 ids sort by time). On send, core deletes the identifier's existing
  codes and inserts, so the race that leaves two rows is rare; ordering makes
  it correct without a JS sort.
- **No `count`.** `select` with `limit: max + 1` and `.length` is all
  append-and-count needs, and not every store has a cheap count.
- **`delete` returns what it removed, atomically.** This is the one
  concurrency property the contract requires of the store, and it carries
  single-use codes (`consumeMagicCode` deletes by `identifier + codeHash` and
  trusts the returned row). Nearly every store's delete is atomic.
- **Every semantic the consumer used to hold moves into core:** the three
  `upsertUser` shapes, `type` insert-only on the identifier path, `undefined`
  means leave alone, never an empty update, the window reset. Tested once.

### Tables

Core names the tables and columns. A consumer whose schema differs maps in
their five functions (a table map with an ORM; a small dictionary otherwise).
This is the honest cost of the change — see "The tagline" below.

| table | columns | unique | indexed |
|---|---|---|---|
| `users` | `id`, `email`, `phoneNumber`, `name`, `imageURL`, `type`, `primaryUserId`, `createdAt`, `updatedAt`, + declared additional fields | `email`, `phoneNumber` | |
| `sessions` | `id`, `userId`, `tokenHash`, `createdAt`, `expiresAt`, `userAgent`, `ipAddress` | `tokenHash` | `userId`, `expiresAt` |
| `magicCodes` | `id`, `identifier`, `codeHash`, `purpose`, `expiresAt` | | `identifier`, `expiresAt` |
| `attempts` | `id`, `key`, `expiresAt` | | `key`, `expiresAt` |
| `connections` | `id`, `userId`, `provider`, `providerAccountId`, `email` | `(provider, providerAccountId)` | `userId` |

Notes:
- `rateLimits` is gone; `attempts` replaces it and is deliberately renamed
  because its semantics change from counter to log. `getRateLimit` was already
  dead — nothing in core calls it.
- `magicCodes.identifier` loses its unique constraint: latest-wins replaces
  one-live-row. `magicCodes.attempts` (always `0`, never read) is dropped.
- **The uniqueness column is the backstop for the whole design** — see
  "Concurrency" — and must be a stated requirement in the reference, not a
  comment in the example's schema.

### Typing: yes, `where` and `row` narrow when the implementer switches

Verified on TypeScript 7.0.2 (scratch files compiled with `--strict`, caller
`@ts-expect-error` lines held). Three facts:

1. **Generic positional parameters do not narrow each other.**
   `insert<T>(table: T, row: Row<T>)` — `switch (table)` narrows `table`, and
   `row` stays `Row<T>`. This is why the contract takes **one input object**
   per call.
2. **A discriminated-union input, destructured, narrows (TS ≥ 4.6).** Core
   exports the unions alongside the generic interface:

   ```ts
   type SelectInput = { [K in Table]: {
     table: K; where: Where<K>; limit: number; offset: number
     orderBy: { column: keyof Row<K>; direction: "asc" | "desc" }
   } }[Table]
   type InsertInput = { [K in Table]: { table: K; row: Insert<K> } }[Table]
   // …UpdateInput, DeleteInput likewise
   ```

   An implementer writes:

   ```ts
   async function select(input: SelectInput) {
     const { table, where, limit } = input            // where narrows with table
     switch (table) {
       case "users":    return run(`… where email = $1`, [where.email])          // where: Partial<AuthUser>
       case "sessions": return run(`… where "tokenHash" = $1`, [where.tokenHash])
       case "attempts": return run(`… where key = $1 limit $2`, [where.key, limit])
     }
   }
   const authDB: AuthDB = {
     select: select as AuthDB["select"],   // the ONE cast: union impl → generic signature
     …
   }
   ```

   The cast is at the boundary, once per function, not per branch. It exists
   because a union-typed implementation cannot be *proven* to satisfy a
   generic signature, only asserted — the same reason overloads have an
   implementation signature.
3. **A table map needs no switch and no cast** (TypeScript #47109, "indexed
   access on a generic key resolves through a mapped type"):

   ```ts
   const authDB: AuthDB = {
     select: (input) => tables[input.table].select(input.where, input.limit),
     insert: (input) => tables[input.table].insert(input.row),
     …
   }
   ```

   where `tables: { [K in Table]: { select(where: Where<K>, limit?): Promise<Row<K>[]>; … } }`.
   This is the Drizzle shape and it is ~40 lines.

So: the interface is declared with generic objects (for core's precise calls
and the table-map style) **and** the unions are exported (for the switch
style). Both compile; the example should show the Drizzle table map, and the
reference should show the switch.

## Eighteen → five

| today | becomes |
|---|---|
| `upsertUser` (identifier, no id) | `select(users, {email})` → `insert` or `update(users, {id}, {name?, imageURL?})` with only defined fields — core never sends an empty `fields` |
| `upsertUser` (no identifier) | `insert(users, {type: "guest", …})` |
| `upsertUser` (id) | `update(users, {id}, fields)` |
| `getUser` | `select(users, {id | email | phoneNumber}, {limit: 1})` |
| `deleteUser` | core deletes the children itself, in this order: `delete(sessions, {userId})`, `delete(connections, {userId})`, `delete(magicCodes, {identifier})` for the user's email and phone, then `delete(users, {id})`. Sessions go first so a failure part-way leaves an account with no live token rather than a live token with no account. No cascade requirement on the store. |
| `upsertSession` (issue) | `insert(sessions, …)` |
| `upsertSession` (slide) | `update(sessions, {id}, {expiresAt, userAgent, ipAddress})` |
| `getSession` | `select(sessions, {tokenHash}, {limit: 1})` |
| `listSessions` | `select(sessions, {userId})` |
| `deleteSession` | `delete(sessions, {tokenHash})` or `delete(sessions, {id, userId})` |
| `deleteSessions` (all / except current) | `select(sessions, {userId})` then `delete(sessions, {id})` per row ≠ current — N round trips on a devices list, fine; or `delete(sessions, {userId})` for "all" |
| `upsertMagicCode` | `delete(magicCodes, {identifier})` then `insert` — latest wins |
| `getMagicCode` | `select(magicCodes, {identifier}, {orderBy: id desc, limit: 1})` |
| `deleteMagicCode` | `delete(magicCodes, {identifier, codeHash?})` — returned row is the proof |
| `getRateLimit` | dropped (already unused) |
| `upsertRateLimit` | `insert(attempts, {key, expiresAt})` then `select(attempts, {key}, {limit: max + 1})` |
| `upsertConnection` | `select(connections, {provider, providerAccountId})` → `insert` or `update(… , {email})` |
| `getConnection` | `select(connections, {provider, providerAccountId}, {limit: 1})` |
| `listConnections` | `select(connections, {userId})` |
| `deleteConnection` | `delete(connections, {userId, provider})` |
| `deleteExpired` | unchanged |

## Concurrency

What can race once core composes instead of the store upserting:

| race | outcome | backstop |
|---|---|---|
| two first sign-ins for the same email | both select nothing, both insert | unique `users.email` → the loser gets a constraint violation → a 500 on a double-submit, not a security hole. **Without the constraint: duplicate users.** |
| two callbacks for the same provider account | same | unique `(provider, providerAccountId)` |
| two sends for one identifier | two live codes | latest wins on verify; the older is dead; swept |
| burst against a rate-limit key | bounded under-count for one burst | see above; stated, not hidden |
| two verifies of the same code | `delete` returning decides the winner | atomic delete — the one store requirement |

The uniqueness requirements are therefore not hygiene; they are the design's
only defence against duplicate accounts. They go in the `AuthDB` reference as a
table, and the conformance suite should at least try a duplicate insert and
expect it to throw.

## Cleanup

Everything cleans itself up. There is no `cleanup: false`.

Three tables carry an `expiresAt` and need sweeping — `sessions`, `magicCodes`,
`attempts`. `connections` does not expire. (Orphaned guest users are the one
thing without an `expiresAt`; parked for now, and not part of this RFC.)

**Today's sweep is broken on Workers.** `create-handler.ts` fires
`deleteExpired()` after every request with `void Promise.resolve(…)` and never
awaits it. On Cloudflare Workers an unawaited promise is not guaranteed to run
once the response is returned — that needs `ctx.waitUntil`, which a
framework-agnostic library never sees. So on the platform the example deploys
to, the sweep may silently never happen. The strategy below fixes that as a
side effect.

The strategy, in layers:

1. **Delete on read where the row is already in hand — free.** An expired
   session read by `resolveSession` is deleted, not just refused. A code past
   its expiry read by `consumeMagicCode` is deleted. Sending a code deletes the
   identifier's previous codes (latest wins does this anyway). None of this
   costs a round trip core was not already making.
2. **A throttled, awaited global sweep — the backstop.** `deleteExpired()` stays
   in the contract (the store knows the time). Core calls it at most once per
   `cleanup.every` (default `"1m"`) per process, tracked by an in-memory
   timestamp, **awaited**, on mutating flows only. Awaited means it works on
   Workers with no `waitUntil`; throttled means the cost is one extra round
   trip per minute per instance, not per request; mutating-only means a
   read-heavy deployment is not paying for it on every `getToken`. A fresh
   serverless instance sweeps on its first mutating request and then once a
   minute — cheap when nothing has expired, which is the steady state.
3. **`attempts` gets no exception and needs none.** The window is in the key,
   so an expired window's rows are never read again; they simply wait for the
   next sweep. Under a flood the table grows for at most one window plus one
   sweep interval. That bound is what `cleanup.every` controls.

The only knob is the interval: `cleanup: { every: Duration }`. Someone running
their own cron sets it long; nobody can turn it off, because with
append-and-count "off" means "grows until you notice". Stores may implement
`deleteExpired` in batches if a large backlog after an outage is a concern;
the contract does not require a single statement.

## What this does to the rest of the repo

- **`/testing`:** `createMemoryDb` becomes a generic in-memory table store —
  smaller, and obviously correct. The conformance suite in the roadmap shrinks
  to "do your five functions behave like tables" plus the duplicate-insert
  check.
- **The example:** `auth-db.ts` becomes a Drizzle table map. The `CASE`
  upsert, the `excluded` reference, and the `updatedAt` workaround all go.
- **`createAuthServer` options:** `cleanup: boolean` becomes
  `cleanup?: { every?: Duration }`; `check-rate-limit.ts` and the
  `create-handler.ts` sweep are rewritten per the cleanup section.
- **Docs:** `reference/auth-db.mdx` is rewritten around five functions, the
  table/uniqueness matrix, the two implementer styles, and the append-and-count
  caveats. The rate-limit concept page gets the edge-posture paragraph.
- **The tagline.** "No adapters" meant "we do not ship packages that chase
  your schema." Still true: nothing is published, nothing is versioned against
  an ORM. But it is now "five functions you write against a schema we name,"
  and honesty says say so. Candidate: *"No adapter packages. Five functions —
  select, insert, update, delete, and a sweep — against your own database."*
  The `ROADMAP.md` "Database adapters — ever" entry needs rewriting to match.

## Open questions for tomorrow

1. ~~`deleteUser` cascade: requirement on the store, or core deletes children
   first?~~ **Decided: core deletes the children.** A forgotten `ON DELETE
   CASCADE` is silent until a deleted account signs in with a refresh token
   that still works; three extra deletes cost nothing and remove the
   requirement entirely. Guest merge (`primaryUserId`) is not a cascade — the
   merged guest row stays, as today.
2. ~~`update` returning rows vs `void`?~~ **Decided: `void`.** See "The
   contract".
3. ~~Should `limit` be required?~~ **Decided: required.**
4. ~~Does the `attempts` sweep need to be unconditional?~~ **Decided: there is
   no off switch for cleanup at all.** See "Cleanup".
5. ~~Additional fields through `Where`/`Insert`?~~ **Decided: flat on `users`
   via `Tables<S>`, as today.**
6. ~~Do the two incremental pieces first, or go straight to five?~~
   **Decided: straight to five.** An intermediate append-and-count inside the
   current eighteen would touch the same files twice for nothing.

## Files touched, for sizing

`packages/server/src/core/auth-db.ts` (contract + types), every call site
listed in the mapping table above, `lib/memory-db.ts`, `http/check-rate-limit.ts`,
`magic-code/*`, `session/issue-session.ts`, `oauth/resolve-oauth-user.ts`,
`tests/**` (memory-db, rate-limit, send-and-consume, oauth-flow at least),
`apps/docs/content/docs/reference/auth-db.mdx`, `guides/neon.mdx`,
`examples/…/src/lib/auth-db.ts` + `db/schema.ts`, `README.md` tagline,
`ROADMAP.md` ("Database adapters — ever", conformance suite entry).
