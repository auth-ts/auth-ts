/**
 * What a user is to this library.
 *
 * `admin` is vocabulary the library carries into the JWT but never assigns —
 * promoting someone is your own SQL. Core only ever writes `guest` or `user`.
 */
export type UserType = "guest" | "user" | "admin"

/** The primitive types an additional field may hold. */
export type AdditionalFieldType = "string" | "number" | "boolean"

/**
 * Declared additional fields, as a name → type map: `{ plan: "string" }`.
 *
 * This is the source of truth twice over. At runtime it is the allowlist a
 * request's fields are validated against; at compile time it is what
 * {@link AuthUser} and {@link AuthInsert} are typed from, so declaring `plan` is
 * what makes `user.plan` exist.
 */
export type AdditionalFieldsSchema = Record<string, AdditionalFieldType>

/** The TypeScript type a declared field type stands for. */
export type AdditionalFieldValue<T extends AdditionalFieldType> =
  T extends "string" ? string : T extends "number" ? number : boolean

/**
 * Declared fields as they come **out** of your table — each optional and
 * nullable, because nothing guarantees a row has set them.
 *
 * A schema with no statically known keys — the bare `AuthDB`, the client —
 * declares nothing about the row, so the row is an open map: your columns
 * are there, whatever they are, and TypeScript is not told otherwise.
 */
export type AdditionalFields<S extends AdditionalFieldsSchema> =
  string extends keyof S
    ? { [field: string]: unknown }
    : { [K in keyof S]?: AdditionalFieldValue<S[K]> | null }

/**
 * Declared fields as core passes them **in** — each optional, never null, since
 * core only writes a value that validated against its declared type.
 *
 * A schema with no statically known keys is an open map here too, for the same
 * reason it is on the way out: nothing has been declared, so nothing can be
 * said about the columns, and a closed type would only be a lie that rejects
 * the row core is actually writing.
 */
export type AdditionalFieldsInput<S extends AdditionalFieldsSchema> =
  string extends keyof S
    ? { [field: string]: unknown }
    : { [K in keyof S]?: AdditionalFieldValue<S[K]> }

/** The user fields core owns. Your declared fields sit beside these on {@link AuthUser}. */
export interface CoreUserFields {
  id: string
  /** Null for guests; unique when present. */
  email?: string | null
  /** Null for guests; unique when present. E.164. */
  phoneNumber?: string | null
  name?: string | null
  imageURL?: string | null
  type: UserType
  /**
   * Set on a **guest** row when its sign-in resolved to an existing account —
   * a pointer saying "this guest's data belongs to that user now".
   *
   * Core writes it and never reads it again: migrating the guest's rows is your
   * decision, on your schedule. It is deliberately never a JWT claim, because it
   * describes a data migration rather than who is signed in.
   */
  primaryUserId?: string | null
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on insert and on every update it makes. */
  updatedAt: Date
}

/**
 * A user row, as core reads it.
 *
 * Your declared `additionalFields` are part of this type, flat, beside the
 * fields core owns — typed from the schema you gave `createAuthServer`, so
 * `{ plan: "string" }` makes `user.plan` a `string | null | undefined`:
 * optional and nullable, because nothing guarantees a row has set it. Where no
 * schema is in scope — the client, or an implementation written against the
 * bare contract — the row is an open map rather than a closed one, which is
 * what a `select *` actually returns.
 *
 * This is also the `user` returned to the browser on sign-in and refresh, so
 * nothing sensitive belongs on it.
 */
export type AuthUser<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = CoreUserFields & AdditionalFields<S>

/** A refresh-token row. Core stores only the hash of the token, never the token. */
export interface AuthSession {
  id: string
  userId: string
  tokenHash: string
  /**
   * When this session was created — the one timestamp core owns.
   *
   * It is an authentication input, not bookkeeping: account deletion reads the
   * age of the *authentication* from it. A sliding "last active" value would say
   * nothing about how recently the person proved who they were. Core writes it
   * on insert and never updates it, so a refresh slides `expiresAt` alone.
   */
  createdAt: Date
  expiresAt: Date
  userAgent?: string | null
  ipAddress?: string | null
  /** Written by core on insert and on every update it makes. */
  updatedAt: Date
}

/** What a live verification code authorizes. Checked on every verify, so a code cannot cross purposes. */
export type VerificationPurpose = "signIn" | "deleteUser"

/**
 * A verification code, stored as an HMAC of the six digits.
 *
 * Several rows may exist for one identifier: a send deletes the identifier's
 * codes and inserts a new one, and a verify reads the newest by `expiresAt`.
 * Latest wins, so a resend still invalidates the code before it.
 */
export interface AuthVerification {
  id: string
  /** Normalized email or E.164 phone number. */
  identifier: string
  codeHash: string
  expiresAt: Date
  purpose: VerificationPurpose
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on insert and on every update it makes. */
  updatedAt: Date
}

/**
 * One counted attempt — a rate-limit request or a wrong guess against a code.
 *
 * A log rather than a counter: rows are only ever inserted and counted, which
 * needs no atomic increment and no conditional upsert. The window is part of
 * `key`, so counting is an equality read and an old window is just old rows.
 */
export interface AuthAttempt {
  id: string
  key: string
  expiresAt: Date
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on insert and on every update it makes. */
  updatedAt: Date
}

/** A provider identity linked to a user. */
export interface AuthIdentity {
  id: string
  userId: string
  provider: string
  /** The provider's stable id — GitHub's numeric id, Google's `sub`. */
  providerUserId: string
  /** Whatever the provider gives that a person recognises. Display only. */
  label?: string | null
  /**
   * The provider's access token, **encrypted**. Never plaintext, never sent to
   * a browser: `GET /identities` strips it, and the data plane must not be
   * granted the column. Short-lived — read it through `getProviderToken`,
   * which refreshes it rather than handing back a spent one.
   */
  accessTokenEncrypted?: string | null
  /** When {@link accessTokenEncrypted} expires, as the provider reported it. */
  accessTokenExpiresAt?: Date | null
  /**
   * The provider's refresh token, **encrypted**. The durable half of the grant:
   * this is what keeps calling a provider's API working for months without the
   * user signing in again, and the one column whose leak matters most.
   */
  refreshTokenEncrypted?: string | null
  /** When {@link refreshTokenEncrypted} expires. Null where the provider reports none. */
  refreshTokenExpiresAt?: Date | null
  /** The scopes actually granted, space-delimited as the provider returned them. */
  scope?: string | null
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on insert and on every update it makes. */
  updatedAt: Date
}

/** The tables core reads and writes. */
export type AuthTable =
  | "users"
  | "sessions"
  | "verifications"
  | "attempts"
  | "identities"

/** Table name → the row it holds. Your declared fields ride flat on `users`. */
export interface AuthTables<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  users: AuthUser<S>
  sessions: AuthSession
  verifications: AuthVerification
  attempts: AuthAttempt
  identities: AuthIdentity
}

/** A row of `T`, with your declared fields where they apply. */
export type AuthRow<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = AuthTables<S>[T]

/**
 * `{ lt }`, `{ gt }`, or both — an open range on one column.
 *
 * The only comparison the contract has, and it exists because expiry is the one
 * question core cannot ask with equality. Both bounds are exclusive.
 */
export interface AuthRange<V> {
  lt?: V
  gt?: V
}

/**
 * A query: column/value pairs, **all** of which must match.
 *
 * A plain value compares for equality. An {@link AuthRange} compares for order,
 * which is what lets core find a live session — `expiresAt` greater than now —
 * in the same statement that updates it, rather than reading first to find out
 * whether it may write.
 *
 * Telling them apart is one check, and the shape is chosen so it stays one: a
 * range is a non-null object that is not a `Date`. Every value core compares
 * for order is a `Date`, so an implementation reads
 * `value instanceof Date || typeof value !== "object"` as "equality" and
 * everything else as a range.
 */
export type AuthWhere<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = {
  [K in keyof AuthRow<S, T>]?: AuthRow<S, T>[K] | AuthRange<AuthRow<S, T>[K]>
}

/** Sort direction, per {@link AuthOrderBy}. */
export type AuthDirection = "asc" | "desc"

/**
 * `{ column: "asc" | "desc" }` — one column, Prisma's shape.
 *
 * One column and a direction is enough for "newest" and for paging, and it is
 * the smallest ordering every store can express. The mapped type strips
 * optionality (`-?`) so an optional column is still a valid key; an empty
 * object and an unknown column are both type errors.
 *
 * The conditional distributes over `T`, so `AuthOrderBy` with no table named
 * means "an ordering for any one of the tables" rather than "an ordering over
 * the columns they all share" — `keyof` of a union is the intersection.
 *
 * Core always passes exactly one key, and an implementation should read one:
 * `const [[column, direction]] = Object.entries(orderBy)`. Forbidding a second
 * key in the type is possible — intersect each member with the others as
 * optional `never` — but it costs every implementation its types, because
 * `Object.entries` then widens the direction to `any`. The guarantee is worth
 * less than the types it takes to state.
 */
export type AuthOrderBy<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = T extends AuthTable
  ? {
      [K in keyof AuthRow<S, T>]-?: { [P in K]: AuthDirection }
    }[keyof AuthRow<S, T>]
  : never

/**
 * A row as core writes it: every column it owns, with `null` written out rather
 * than left undefined.
 *
 * `id` is present only when `generateId` is configured on the server; otherwise
 * it is omitted and your column default (`uuidv7()`, a `$defaultFn`, an
 * identity column) fills it. Either way {@link AuthDB.insert} returns the
 * stored row, which is how core learns the id.
 */
export type AuthInsert<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = T extends "users"
  ? Omit<CoreUserFields, "id"> & { id?: string } & AdditionalFieldsInput<S>
  : Omit<AuthRow<S, T>, "id"> & { id?: string }

/** {@link AuthDB.select}'s input as a union over the tables — see `defineAuthDB`. */
export type AuthSelectInput<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = {
  [K in AuthTable]: {
    table: K
    where: AuthWhere<S, K>
    limit: number
    offset: number
    orderBy: AuthOrderBy<S, K>
  }
}[AuthTable]

/** {@link AuthDB.insert}'s input as a union over the tables — see `defineAuthDB`. */
export type AuthInsertInput<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = { [K in AuthTable]: { table: K; values: AuthInsert<S, K> } }[AuthTable]

/** {@link AuthDB.update}'s input as a union over the tables — see `defineAuthDB`. */
export type AuthUpdateInput<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = {
  [K in AuthTable]: {
    table: K
    where: AuthWhere<S, K>
    values: Partial<AuthRow<S, K>>
  }
}[AuthTable]

/** {@link AuthDB.delete}'s input as a union over the tables — see `defineAuthDB`. */
export type AuthDeleteInput<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = { [K in AuthTable]: { table: K; where: AuthWhere<S, K> } }[AuthTable]

/**
 * The integration surface: four table functions and an optional sweep.
 *
 * This interface *is* the product. There are no adapter packages — you write
 * these functions against your own tables, and in exchange the library never
 * owns your schema, your migrations, or your data.
 *
 * Core names the tables and the columns it reads; a schema that differs maps
 * them inside these functions. What core needs of the store is small and
 * stated:
 *
 * | table | unique | indexed | swept |
 * | --- | --- | --- | --- |
 * | `users` | `email`, `phoneNumber` | | |
 * | `sessions` | `tokenHash` | `userId`, `expiresAt` | `expiresAt` |
 * | `verifications` | | `identifier`, `expiresAt` | `expiresAt` |
 * | `attempts` | | `key`, `expiresAt` | `expiresAt` |
 * | `identities` | `(provider, providerUserId)` | `userId` | |
 *
 * **The uniqueness column is not hygiene, it is the design.** Core composes a
 * read and a write where it used to hand your store an upsert, so two first
 * sign-ins for one email both find nothing and both insert. The constraint is
 * what turns that race into a failed request instead of two accounts for one
 * person. The same holds for `(provider, providerUserId)`.
 *
 * The one concurrency property core requires is that {@link AuthDB.delete} is
 * atomic and returns what it removed: that is what makes a verification code usable
 * exactly once, since two verifiers can both read the row but only one deletes
 * it.
 *
 * These functions are pure with respect to the request: none of them receive
 * headers. Header-dependent session resolution is a spoofable auth bypass, and
 * non-HTTP callers (tests, migrations, the in-memory fixture) drive this
 * contract directly. For multi-tenancy, close over the tenant when constructing
 * the server instead.
 *
 * `S` is your declared `additionalFields`. Type an implementation as
 * `AuthDB<typeof additionalFields>` and every `users` row and write carries them
 * typed; the bare `AuthDB` sees them as an open map of primitives, and any
 * server accepts it.
 */
export interface AuthDB<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  /**
   * Reads rows matching `where`, ordered, offset, and capped.
   *
   * Nothing here is optional, so there is no `undefined` to branch on and one
   * code path per store. Core fills every value at the call site, and an
   * unbounded read is a type error: every list core makes has a ceiling.
   */
  select<T extends AuthTable>(input: {
    table: T
    where: AuthWhere<S, T>
    limit: number
    offset: number
    orderBy: AuthOrderBy<S, T>
  }): Promise<AuthRow<S, T>[]>

  /**
   * Inserts one row and returns it as stored.
   *
   * `undefined` is allowed because not every store hands the row back the same
   * way — `RETURNING` gives a set to pick from, a document store gives the
   * document, and some give nothing at all. Return what you have; core decides
   * what having nothing means, so no implementation has to invent a row or
   * phrase that failure itself.
   *
   * What comes back is how core learns anything the store decided: the `id`
   * when `generateId` is not configured, and any column default. A unique
   * violation must throw rather than merge — core reads before it inserts, and
   * the constraint is deliberately the arbiter of the race between the two.
   */
  insert<T extends AuthTable>(input: {
    table: T
    values: AuthInsert<S, T>
  }): Promise<AuthRow<S, T> | undefined>

  /**
   * Applies `fields` to every row matching `where`.
   *
   * `fields` always carries at least one defined value — core composes the set
   * itself and skips the call entirely when a request changes nothing, so no
   * implementation needs a guard against the empty `SET` that most query
   * builders reject.
   *
   * Returns the rows it wrote, as {@link AuthDB.delete} does. That is what lets
   * one statement both find and touch a row: core asks for a session whose
   * `expiresAt` is still ahead, and learns from what comes back whether there
   * was one — rather than reading to find out if it may write, then writing.
   */
  update<T extends AuthTable>(input: {
    table: T
    where: AuthWhere<S, T>
    values: Partial<AuthRow<S, T>>
  }): Promise<AuthRow<S, T>[]>

  /**
   * Deletes every row matching `where` and returns what it removed.
   *
   * `DELETE … RETURNING *`, `findOneAndDelete`, `OUTPUT deleted.*`. One round
   * trip, and the returned rows are proof: they are how core answers 404 rather
   * than 204, and how a single-use verification code picks a winner between two
   * verifiers who both read it.
   */
  delete<T extends AuthTable>(input: {
    table: T
    where: AuthWhere<S, T>
  }): Promise<AuthRow<S, T>[]>

  /**
   * Pins `S` so a schema mismatch is caught.
   *
   * `S` appears only inside generic methods, and TypeScript measures a type
   * parameter used that way as unused — which would let
   * `AuthDB<{ plan: "string" }>` satisfy `AuthDB<{ plan: "number" }>`. One
   * parameter position is enough to make it count. It has to be a method
   * rather than a property, and no `in`/`out` annotation would do instead:
   * both are strict, and what is wanted here is the bivariance a method
   * parameter gives — refuse two schemas that disagree, while a server
   * declaring one still accepts an implementation written against the bare
   * contract.
   *
   * Never implemented, never called.
   *
   * @internal
   */
  __schema?(schema: S): void
}

/**
 * Types an implementation of this contract, so that yours needs no casts.
 *
 * Core's own calls are precise because {@link AuthDB} is generic, but a generic
 * signature cannot be *proven* by a union-typed implementation, only asserted —
 * the same reason an overload has an implementation signature. This helper
 * holds that assertion, once, so your code has no casts in it:
 *
 * ```ts
 * export const authDB = defineAuthDB({
 *   async select({ table, where, limit }) {
 *     switch (table) {
 *       // `where` narrows with `table`: Partial<AuthUser> here,
 *       case "users": return run(`… where email = $1`, [where.email])
 *       case "attempts": return run(`… where key = $1 limit $2`, [where.key, limit])
 *       …
 *     }
 *   },
 *   …
 * })
 * ```
 *
 * A table map needs no switch, but it does want this helper for the same
 * reason — see the reference.
 */
export function defineAuthDB<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
>(implementation: {
  select(input: AuthSelectInput<S>): Promise<AuthRow<S, AuthTable>[]>
  insert(input: AuthInsertInput<S>): Promise<AuthRow<S, AuthTable> | undefined>
  update(input: AuthUpdateInput<S>): Promise<unknown>
  delete(input: AuthDeleteInput<S>): Promise<AuthRow<S, AuthTable>[]>
}): AuthDB<S> {
  return implementation as unknown as AuthDB<S>
}
