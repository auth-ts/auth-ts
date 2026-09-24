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
 * A schema with no statically known keys — the bare `AuthDatabase`, the client —
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

/** The user columns core owns. Your `additionalFields` sit beside them. */
export interface CoreUserFields {
  /** Primary key. */
  id: string
  /** Unique when present. Null for guests. */
  email?: string | null
  /** E.164. Unique when present. Null for guests. */
  phoneNumber?: string | null
  /** Display name. */
  name?: string | null
  /** An avatar URL, data URI or storage key. Core never reads it. */
  image?: string | null
  /** `guest`, `user` or `admin`. Core writes only the first two. */
  type: UserType
  /** On a guest who signed in to an existing account, that account's id. */
  primaryUserId?: string | null
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on every write. */
  updatedAt: Date
}

/** A user row: the core columns plus your `additionalFields`. Returned to the browser. */
export type AuthUser<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = CoreUserFields & AdditionalFields<S>

/** A session row. The token is `id.secret`; only `sha256` of the secret is stored. */
export interface AuthSession {
  /** Primary key, and the token's `sid` claim. */
  id: string
  /** The user signed in. */
  userId: string
  /** SHA-256 of the token's secret, as hex. */
  secretHash: string
  /** When the session was created. Never updated. */
  createdAt: Date
  /** The browser that signed in. */
  userAgent?: string | null
  /** The client IP at sign-in. */
  ipAddress?: string | null
  /** How the session was authenticated: `otp`, `sms`, `fed` or `anonymous`. */
  amr?: string[] | null
  /** When the session was last used, to the hour. */
  updatedAt: Date
}

/** What a verification code is for. Checked on every verify. */
export type VerificationPurpose =
  | "signIn"
  | "identity"
  | "emailChange"
  | "phoneChange"

/** A verification code, bound to the client that requested it. */
export interface AuthVerification {
  /** Primary key. */
  id: string
  /** Email address or E.164 phone number. */
  identifier: string
  /** The code under scrypt: `$scrypt$ln=14,r=8,p=1$<salt>$<key>`. */
  codeHash: string
  /** SHA-256 of the requesting client's attempt token. */
  attemptHash: string
  /** What the code is for. */
  purpose: VerificationPurpose
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on every write. */
  updatedAt: Date
}

/** One rate-limit token bucket. */
export interface AuthRateLimit {
  /** Primary key. */
  id: string
  /** The bucket, e.g. `guess:<address>` or `guest:ip:<address>`. */
  key: string
  /** Tokens left. */
  tokenCount: number
  /** When the last token was refilled. */
  lastRefilledAt: Date
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on every write. */
  updatedAt: Date
}

/** A GitHub or Google account linked to a user. */
export interface AuthIdentity {
  /** Primary key. */
  id: string
  /** The user it belongs to. */
  userId: string
  /** `github` or `google`. */
  provider: string
  /** The provider's stable id: GitHub's numeric id, Google's `sub`. */
  providerUserId: string
  /** A display name for the account. */
  label?: string | null
  /** The scopes granted, space-separated. */
  scope?: string | null
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on every write. */
  updatedAt: Date
}

/** An identity's provider tokens. Never grant this table; it must cascade from `identities`. */
export interface AuthIdentitySecret {
  /** Primary key. */
  id: string
  /** The identity these belong to. */
  identityId: string
  /** The provider's access token. Read it with `getProviderToken`. */
  accessToken?: string | null
  /** When `accessToken` expires. */
  accessTokenExpiresAt?: Date | null
  /** The provider's refresh token. */
  refreshToken?: string | null
  /** When `refreshToken` expires, if the provider says. */
  refreshTokenExpiresAt?: Date | null
  /** Written by core on insert. */
  createdAt: Date
  /** Written by core on every write. */
  updatedAt: Date
}

/** The tables core reads and writes. */
export const authTables = [
  "users",
  "sessions",
  "verifications",
  "rateLimits",
  "identities",
  "identitySecrets"
] as const

/** One of {@link authTables}. */
export type AuthTable = (typeof authTables)[number]

/** Table name → the row it holds. Your declared fields ride flat on `users`. */
export interface AuthTables<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  users: AuthUser<S>
  sessions: AuthSession
  verifications: AuthVerification
  rateLimits: AuthRateLimit
  identities: AuthIdentity
  identitySecrets: AuthIdentitySecret
}

/**
 * How your store holds a timestamp.
 *
 * Core thinks in `Date`. A driver that types `timestamptz` as text — drizzle
 * with `mode: "string"`, PostgREST, a document store — thinks in ISO 8601.
 * Name `"string"` on {@link defineAuthDatabase} and the helper converts at the
 * boundary: the implementation is typed in strings, and core still reads
 * `Date`s. `"date"` is the default and converts nothing.
 *
 * Every type on this page that carries a timestamp takes the mode as its first
 * parameter, so `AuthWhere<"string">` is the shape a string-mode helper reads.
 */
export type AuthTimestampMode = "date" | "string"

type StoredValue<V> = V extends Date
  ? string
  : V extends object
    ? { [K in keyof V]: StoredValue<V[K]> }
    : V

type Stored<M extends AuthTimestampMode, T> = M extends "date"
  ? T
  : StoredValue<T>

/** A row of `T`, with your declared fields where they apply. */
export type AuthRow<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = Stored<M, AuthTables<S>[T]>

/** The operators a condition may name. */
export type AuthDatabaseOperator = "eq" | "lt" | "gt"

/**
 * `{ eq }` on any column; `{ lt }`, `{ gt }`, or both on `createdAt` and `updatedAt`.
 *
 * Every condition names its operator, so an implementation maps keys to
 * operators and never has to tell a value from a range by looking at it. The
 * members are required rather than optional: a key that is present has a value,
 * and `{}` is not a condition, so `Object.entries` is the whole of a `where`.
 *
 * Order is the only comparison the contract has beyond equality, and it exists
 * because age is the one question core cannot ask with `eq`. Both bounds are
 * exclusive. {@link AuthWhere} confines it to the two timestamps core writes
 * rather than offering it on every column, so an implementation has two
 * columns to think about instead of the whole row.
 */
export type AuthCondition<V> =
  | { eq: V }
  | { lt: V }
  | { gt: V }
  | { lt: V; gt: V }

/**
 * A query: column/condition pairs, **all** of which must match.
 *
 * Every column takes `{ eq }`, and `createdAt` and `updatedAt` also take an
 * order — that one exception is what lets core find a live session, used
 * within its lifetime, in the same statement that updates it, rather than
 * reading first to find out whether it may write.
 *
 * **`null` is not a value here**, though the columns are nullable. Core looks
 * accounts up by an identifier, and an identifier that came back null would
 * otherwise compile into a query matching the first row that has none — some
 * arbitrary guest. Excluding it makes that a type error at the call site
 * instead of a check somebody has to remember, and leaves every implementation
 * with one comparison rather than an `IS NULL` branch it will never reach.
 */
export type AuthWhere<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = T extends AuthTable
  ? {
      // Index signatures make Object.entries infer any.
      [K in keyof AuthRow<M, S, T> as string extends K ? never : K]?: K extends
        | "createdAt"
        | "updatedAt"
        ? AuthCondition<NonNullable<AuthRow<M, S, T>[K]>>
        : { eq: NonNullable<AuthRow<M, S, T>[K]> }
    }
  : never

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
      [K in keyof AuthRow<"date", S, T>]-?: { [P in K]: AuthDirection }
    }[keyof AuthRow<"date", S, T>]
  : never

/**
 * A row as core writes it: every column it owns, with `null` written out rather
 * than left undefined.
 *
 * `id` is present only when `generateId` is configured on the server; otherwise
 * it is omitted and your column default (`uuidv7()`, a `$defaultFn`, an
 * identity column) fills it. Either way {@link AuthDatabase.insert} returns the
 * stored row, which is how core learns the id.
 */
export type AuthInsert<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema,
  T extends AuthTable = AuthTable
> = T extends "users"
  ? Stored<M, Omit<CoreUserFields, "id">> & {
      id?: string
    } & AdditionalFieldsInput<S>
  : Omit<AuthRow<M, S, T>, "id"> & { id?: string }

/** {@link AuthDatabase.select}'s input as a union over the tables — see `defineAuthDatabase`. */
export type AuthSelectInput<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = {
  [K in AuthTable]: {
    table: K
    where: AuthWhere<M, S, K>
    limit: number
    orderBy: AuthOrderBy<S, K>
  }
}[AuthTable]

/** {@link AuthDatabase.insert}'s input as a union over the tables — see `defineAuthDatabase`. */
export type AuthInsertInput<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = { [K in AuthTable]: { table: K; values: AuthInsert<M, S, K> } }[AuthTable]

/** {@link AuthDatabase.update}'s input as a union over the tables — see `defineAuthDatabase`. */
export type AuthUpdateInput<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = {
  [K in AuthTable]: {
    table: K
    where: AuthWhere<M, S, K>
    values: Partial<AuthRow<M, S, K>>
  }
}[AuthTable]

/** {@link AuthDatabase.delete}'s input as a union over the tables — see `defineAuthDatabase`. */
export type AuthDeleteInput<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> = { [K in AuthTable]: { table: K; where: AuthWhere<M, S, K> } }[AuthTable]

/** The four functions that read and write your tables. */
export interface AuthDatabase<
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
> {
  /**
   * Reads rows matching `where`, ordered and capped.
   * @remarks `({ table, where, limit, orderBy }) => Promise<Row[]>`
   */
  select<T extends AuthTable>(input: {
    table: T
    where: AuthWhere<"date", S, T>
    limit: number
    orderBy: AuthOrderBy<S, T>
  }): Promise<AuthRow<"date", S, T>[]>

  /**
   * Inserts one row and returns it as stored. A unique violation must throw.
   * @remarks `({ table, values }) => Promise<Row | undefined>`
   */
  insert<T extends AuthTable>(input: {
    table: T
    values: AuthInsert<"date", S, T>
  }): Promise<AuthRow<"date", S, T> | undefined>

  /**
   * Updates every row matching `where` and returns them.
   * @remarks `({ table, where, values }) => Promise<Row[]>`
   */
  update<T extends AuthTable>(input: {
    table: T
    where: AuthWhere<"date", S, T>
    values: Partial<AuthRow<"date", S, T>>
  }): Promise<AuthRow<"date", S, T>[]>

  /**
   * Deletes every row matching `where` and returns them. Must be atomic.
   * @remarks `({ table, where }) => Promise<Row[]>`
   */
  delete<T extends AuthTable>(input: {
    table: T
    where: AuthWhere<"date", S, T>
  }): Promise<AuthRow<"date", S, T>[]>

  /**
   * Pins `S` so a schema mismatch is caught.
   *
   * `S` appears only inside generic methods, and TypeScript measures a type
   * parameter used that way as unused — which would let
   * `AuthDatabase<{ plan: "string" }>` satisfy `AuthDatabase<{ plan: "number" }>`. One
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

/** Types your `AuthDatabase` so it needs no casts. `timestamps: "string"` converts ISO strings. */
export function defineAuthDatabase<
  M extends AuthTimestampMode = "date",
  S extends AdditionalFieldsSchema = AdditionalFieldsSchema
>(implementation: {
  timestamps?: M
  select(input: AuthSelectInput<M, S>): Promise<AuthRow<M, S>[]>
  insert(input: AuthInsertInput<M, S>): Promise<AuthRow<M, S> | undefined>
  update(input: AuthUpdateInput<M, S>): Promise<AuthRow<M, S>[]>
  delete(input: AuthDeleteInput<M, S>): Promise<AuthRow<M, S>[]>
}): AuthDatabase<S> {
  if (implementation.timestamps !== "string") {
    return implementation as unknown as AuthDatabase<S>
  }

  const store = implementation as unknown as {
    select(input: Loose): Promise<Loose[]>
    insert(input: Loose): Promise<Loose | undefined>
    update(input: Loose): Promise<Loose[]>
    delete(input: Loose): Promise<Loose[]>
  }
  const loadRows = (table: AuthTable, rows: Loose[]) =>
    rows.map((row) => mapTimestamps(table, row, loaded))

  const database = {
    select: ({ table, where, limit, orderBy }: AuthSelectInput) =>
      store
        .select({
          table,
          where: mapTimestamps(table, where, stored),
          limit,
          orderBy
        })
        .then((rows) => loadRows(table, rows)),
    insert: ({ table, values }: AuthInsertInput) =>
      store
        .insert({ table, values: mapTimestamps(table, values, stored) })
        .then((row) => row && mapTimestamps(table, row, loaded)),
    update: ({ table, where, values }: AuthUpdateInput) =>
      store
        .update({
          table,
          where: mapTimestamps(table, where, stored),
          values: mapTimestamps(table, values, stored)
        })
        .then((rows) => loadRows(table, rows)),
    delete: ({ table, where }: AuthDeleteInput) =>
      store
        .delete({ table, where: mapTimestamps(table, where, stored) })
        .then((rows) => loadRows(table, rows))
  }

  return database as unknown as AuthDatabase<S>
}

type Loose = Record<string, unknown>

const timestampColumns: Record<AuthTable, string[]> = {
  users: ["createdAt", "updatedAt"],
  sessions: ["createdAt", "updatedAt"],
  verifications: ["createdAt", "updatedAt"],
  rateLimits: ["createdAt", "updatedAt", "lastRefilledAt"],
  identities: ["createdAt", "updatedAt"],
  identitySecrets: [
    "createdAt",
    "updatedAt",
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt"
  ]
}

const mapTimestamps = (
  table: AuthTable,
  record: Loose,
  map: (value: unknown) => unknown
) => {
  const mapped = { ...record }
  for (const column of timestampColumns[table]) {
    if (mapped[column] != null) mapped[column] = map(mapped[column])
  }
  return mapped
}

// A condition wraps its Date in an operator
const stored = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Loose).map(([key, nested]) => [key, stored(nested)])
  )
}

const loaded = (value: unknown) =>
  typeof value === "string" ? new Date(value) : value
