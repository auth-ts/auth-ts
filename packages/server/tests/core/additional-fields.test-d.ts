import { describe, expectTypeOf, it } from "vitest"
import type {
  AdditionalFieldsSchema,
  AuthDB,
  AuthInsert,
  AuthOrderBy,
  AuthRange,
  AuthRow,
  AuthUser,
  AuthWhere
} from "../../src/core/auth-db"
import type { WithUserFields } from "../../src/core/create-auth-server"
import { createAuthServer } from "../../src/core/create-auth-server"
import type { CurrentSession } from "../../src/endpoints/session"
import { createMemoryDb } from "../../src/lib/memory-db"

// Never executed — vitest typechecks this file and runs nothing in it — so the
// options only have to satisfy the types.
const base = {
  email: { sendCode: () => {} },
  jwt: { privateKey: "unused" },
  secret: "unused"
}

const additionalFields = {
  plan: "string",
  seats: "number",
  betaOptIn: "boolean"
} satisfies AdditionalFieldsSchema

type Declared = typeof additionalFields

describe("AuthUser carries the declared fields", () => {
  it("types each field from its declaration: optional and nullable on the way out", () => {
    expectTypeOf<AuthUser<Declared>["plan"]>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<AuthUser<Declared>["seats"]>().toEqualTypeOf<
      number | null | undefined
    >()
    expectTypeOf<AuthUser<Declared>["betaOptIn"]>().toEqualTypeOf<
      boolean | null | undefined
    >()
    // The core fields are untouched.
    expectTypeOf<AuthUser<Declared>["id"]>().toEqualTypeOf<string>()
  })

  it("types them optional and never null on the way in", () => {
    expectTypeOf<AuthInsert<Declared, "users">["plan"]>().toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf<AuthInsert<Declared, "users">["seats"]>().toEqualTypeOf<
      number | undefined
    >()
    // `id` is optional on the way in, because the store fills it unless
    // `generateId` is configured — and required on the way out, because by then
    // it exists.
    expectTypeOf<AuthInsert<Declared, "users">["id"]>().toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf<AuthRow<Declared, "users">>().toEqualTypeOf<
      AuthUser<Declared>
    >()
  })

  it("leaves the bare row an open map, because a select * returns your columns", () => {
    // No schema in scope — the client, a bare adapter — so the row admits
    // anything beside the core fields, and says nothing about what it is.
    expectTypeOf<AuthUser["plan"]>().toEqualTypeOf<unknown>()
    // Core's own columns keep their types even in the open map.
    expectTypeOf<AuthUser["createdAt"]>().toEqualTypeOf<Date>()
    expectTypeOf<AuthUser["type"]>().toEqualTypeOf<"guest" | "user" | "admin">()
    // A row with extra columns of any type is a bare AuthUser.
    const row = {
      id: "1",
      type: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      plan: "pro"
    }
    expectTypeOf(row).toMatchTypeOf<AuthUser>()
  })
})

describe("the table types the four functions take", () => {
  /** A schema whose one declared field is deliberately not a string. */
  type Numeric = { plan: "number" }

  const usersWhere = (where: AuthWhere<Numeric, "users">) => where
  const usersOrder = (orderBy: AuthOrderBy<Declared, "users">) => orderBy

  it("queries a declared field at its declared type", () => {
    expectTypeOf(usersWhere({ plan: 3 }).plan).toEqualTypeOf<
      number | null | undefined | AuthRange<number | null | undefined>
    >()
    // Core fields query the same way, and take a range where order applies.
    usersWhere({ email: "ada@example.com", type: "guest" })
    usersWhere({ createdAt: { gt: new Date() } })

    // @ts-expect-error plan is declared a number, so a string cannot match it
    usersWhere({ plan: "pro" })
    // @ts-expect-error nothing declares `tier`, so nothing can query it
    usersWhere({ tier: 1 })
  })

  it("orders by a declared column, in a named direction", () => {
    usersOrder({ id: "asc" })
    // An optional column is still a key to sort on.
    usersOrder({ plan: "desc" })

    // @ts-expect-error an ordering has to name a column
    usersOrder({})
    // @ts-expect-error nothing declares `tier`, so nothing can sort on it
    usersOrder({ tier: "asc" })
    // @ts-expect-error a direction is one of two words
    usersOrder({ id: "ascending" })

    // A second key is not rejected, and that is deliberate: stating it in the
    // type costs every implementation the direction's own type, since
    // `Object.entries` then widens it to `any`. Core passes one key.
    usersOrder({ id: "asc", email: "desc" })
  })
})

describe("AuthDB measures the schema it is typed with", () => {
  it("takes a bare implementation as any server's store", () => {
    // No schema declared, so nothing is claimed about the columns and every
    // server accepts it — including one that declares fields of its own.
    const bare: AuthDB = createMemoryDb()
    const declared: AuthDB<{ plan: "number" }> = createMemoryDb()

    expectTypeOf(bare).toMatchTypeOf<AuthDB>()
    expectTypeOf(declared).toMatchTypeOf<AuthDB<{ plan: "number" }>>()
  })

  it("keeps two declared schemas apart, which is what __schema is for", () => {
    const stringly: AuthDB<{ plan: "string" }> = createMemoryDb()

    // Without the phantom member the schema would count as unused and these
    // two would be the same type, so a store that writes strings would satisfy
    // a server that declared numbers.
    // @ts-expect-error plan is a string there and a number here
    const numeric: AuthDB<{ plan: "number" }> = stringly
    expectTypeOf(numeric).toMatchTypeOf<AuthDB<{ plan: "number" }>>()
  })
})

describe("createAuthServer infers the schema and types everything it returns", () => {
  it("from user.additionalFields, with the adapter checked against it rather than inferred from it", async () => {
    const server = createAuthServer({
      ...base,
      db: createMemoryDb(),
      user: { additionalFields }
    })

    const user = await server.getUser({ headers: new Headers() })
    expectTypeOf(user.plan).toEqualTypeOf<string | null | undefined>()
    expectTypeOf(user.seats).toEqualTypeOf<number | null | undefined>()

    const session = await server.getSession({ headers: new Headers() })
    // Everything that is not a user passes through unchanged.
    expectTypeOf(session.createdAt).toEqualTypeOf<Date>()
  })

  it("refuses an adapter typed against a different schema", () => {
    const typed: AuthDB<{ plan: "number" }> = createMemoryDb()

    createAuthServer({
      ...base,
      // @ts-expect-error the adapter says plan is a number; the schema says string
      db: typed,
      user: { additionalFields: { plan: "string" } }
    })
  })

  it("accepts a bare adapter into a server that declares fields", () => {
    const bare: AuthDB = createMemoryDb()
    createAuthServer({ ...base, db: bare, user: { additionalFields } })
  })

  it("stays open when nothing is declared", async () => {
    const server = createAuthServer({ ...base, db: createMemoryDb() })
    const user = await server.getUser({ headers: new Headers() })
    expectTypeOf(user.anything).toEqualTypeOf<unknown>()
  })
})

describe("WithUserFields", () => {
  it("replaces users wherever they appear and leaves everything else alone", () => {
    type Typed = WithUserFields<
      { user: AuthUser; session: CurrentSession },
      Declared
    >
    expectTypeOf<Typed["user"]["plan"]>().toEqualTypeOf<
      string | null | undefined
    >()
    expectTypeOf<Typed["session"]["createdAt"]>().toEqualTypeOf<Date>()

    expectTypeOf<WithUserFields<AuthUser[], Declared>>().toEqualTypeOf<
      AuthUser<Declared>[]
    >()
    expectTypeOf<
      WithUserFields<AuthUser | null, Declared>
    >().toEqualTypeOf<AuthUser<Declared> | null>()
  })
})
