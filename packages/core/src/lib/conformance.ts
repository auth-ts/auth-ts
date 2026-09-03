import type {
  AdditionalFieldsSchema,
  AuthDB,
  AuthInsert,
  AuthRow,
  AuthTable,
  AuthWhere
} from "../core/auth-db"

/** One requirement of the contract, and a way to find out whether it holds. */
export interface AuthDBCheck {
  name: string
  run(db: AuthDB): Promise<void>
}

/** Fails the check, saying what the contract asked for and why it matters. */
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Inserts, and holds the store to its side of the bargain: it returns the row. */
async function create<T extends AuthTable>(
  db: AuthDB,
  table: T,
  values: AuthInsert<AdditionalFieldsSchema, T>
): Promise<AuthRow<AdditionalFieldsSchema, T>> {
  const row = await db.insert({ table, values })
  expect(
    row,
    `insert into ${table} resolved to nothing. It must return the stored row: core has no other way to learn the id your database generated.`
  )
  return row
}

/** Requires `attempt` to reject. */
async function refuses(attempt: () => Promise<unknown>, message: string) {
  try {
    await attempt()
  } catch {
    return
  }
  expect(false, message)
}

const future = () => new Date(Date.now() + 60_000)
const past = () => new Date(Date.now() - 60_000)

/** Every column core writes on a users row, so a check varies only what it means to. */
const person = (fields: Record<string, unknown> = {}) => ({
  createdAt: new Date(),
  updatedAt: new Date(),
  email: null,
  phoneNumber: null,
  name: null,
  image: null,
  primaryUserId: null,
  type: "user" as const,
  ...fields
})

/** Marks each run's rows, so two runs at once cannot see each other's. */
const unique = () =>
  `conformance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Whether these rows came back at exactly these times, in exactly this order. */
function ordered(rows: { expiresAt: Date }[], times: number[]) {
  return (
    rows.length === times.length &&
    rows.every((row, index) => row.expiresAt.getTime() === times[index])
  )
}

/**
 * What the contract asks of a store, as checks you can run against your own.
 *
 * Every check cleans up after itself, so point it at a real database — which is
 * the point. The parts that matter most are the ones an in-memory fixture
 * cannot tell you: whether your unique constraints are really there, and
 * whether your `delete` really returns what it removed.
 *
 * Each check throws on failure and resolves on success, so it fits any runner
 * rather than dragging a test framework into your dependencies:
 *
 * ```ts
 * import { authDBChecks } from "@auth-ts/core/testing"
 * import { authDB } from "./auth-db"
 *
 * describe("authDB", () => {
 *   for (const check of authDBChecks) {
 *     it(check.name, () => check.run(authDB))
 *   }
 * })
 * ```
 */
export const authDBChecks: AuthDBCheck[] = [
  {
    name: "insert returns the row as stored, with an id",
    async run(db) {
      const email = `${unique()}@example.test`
      const row = await create(db, "users", person({ email }))
      try {
        expect(
          typeof row.id === "string" && row.id.length > 0,
          "the returned row has no id. Core reads the id back rather than assuming one, so an insert that drops it breaks every sign-in."
        )
        expect(
          row.email === email,
          "the returned row does not carry the value it was given"
        )
      } finally {
        await db.delete({ table: "users", where: { email } })
      }
    }
  },
  {
    name: "select matches on every column given, and only on equality",
    async run(db) {
      const email = `${unique()}@example.test`
      await create(db, "users", person({ email, name: "Ada" }))
      try {
        const matching = (where: { email: string; name: string }) =>
          db.select({
            table: "users",
            where,
            limit: 10,
            orderBy: { id: "asc" }
          })

        expect(
          (await matching({ email, name: "Ada" })).length === 1,
          "a where naming two columns did not match the row that has both"
        )
        expect(
          (await matching({ email, name: "Grace" })).length === 0,
          "every column in a where has to match. This one matched a row on some of them, which would let one person's code verify against another's identifier."
        )
      } finally {
        await db.delete({ table: "users", where: { email } })
      }
    }
  },
  {
    name: "select honours limit and both directions of orderBy",
    async run(db) {
      const key = unique()
      const times = [3, 1, 2].map(
        (minutes) => new Date(Date.now() + minutes * 60_000)
      )
      for (const expiresAt of times) {
        await create(db, "attempts", {
          key,
          expiresAt,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      }
      try {
        const page = (direction: "asc" | "desc", limit: number) =>
          db.select({
            table: "attempts",
            where: { key },
            limit,
            orderBy: { expiresAt: direction }
          })

        const ascending = times.map((date) => date.getTime()).sort()

        expect(
          ordered(await page("asc", 10), ascending),
          "orderBy asc did not sort by the column it was given. Core reads the live verification code as the newest row, so an ordering that is ignored hands back a stale one."
        )
        expect(
          ordered(await page("desc", 10), [...ascending].reverse()),
          "orderBy desc did not reverse the order"
        )
        expect(
          (await page("asc", 2)).length === 2,
          "limit did not cap the number of rows returned"
        )
        expect(
          ordered(await page("asc", 2), ascending.slice(0, 2)),
          "limit did not cap from the start of the order"
        )
      } finally {
        await db.delete({ table: "attempts", where: { key } })
      }
    }
  },
  {
    name: "update returns the rows it changed",
    async run(db) {
      const email = `${unique()}@example.test`
      const row = await create(db, "users", person({ email, name: "Ada" }))
      try {
        const changed = await db.update({
          table: "users",
          where: { id: row.id },
          values: { name: "Ada Lovelace" }
        })

        expect(
          changed.length === 1 && changed[0]?.name === "Ada Lovelace",
          "update must return what it wrote, as delete does. Core finds and touches a session in one statement and learns from the result whether there was a live one — an empty return there is an authenticated request refused."
        )
        expect(
          (
            await db.update({
              table: "users",
              where: { id: crypto.randomUUID() },
              values: { name: "nobody" }
            })
          ).length === 0,
          "update matched nothing but did not report an empty result"
        )
      } finally {
        await db.delete({ table: "users", where: { email } })
      }
    }
  },
  {
    name: "a range matches on order, and only within its bounds",
    async run(db) {
      const key = unique()
      const times = [1, 2, 3].map(
        (minutes) => new Date(Date.now() + minutes * 60_000)
      )
      for (const expiresAt of times) {
        await create(db, "attempts", {
          key,
          expiresAt,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      }
      const [first, second, third] = times as [Date, Date, Date]
      try {
        const count = async (
          where: AuthWhere<AdditionalFieldsSchema, "attempts">
        ) =>
          (
            await db.select({
              table: "attempts",
              where,
              limit: 10,
              orderBy: { expiresAt: "asc" }
            })
          ).length

        expect(
          (await count({ key, expiresAt: { gt: second } })) === 1,
          "gt must exclude its own bound and everything below it"
        )
        expect(
          (await count({ key, expiresAt: { lt: second } })) === 1,
          "lt must exclude its own bound and everything above it"
        )
        expect(
          (await count({ key, expiresAt: { gt: first, lt: third } })) === 1,
          "lt and gt together must bound both ends"
        )
        expect(
          (await count({ key, expiresAt: { gt: third } })) === 0,
          "a range past every row must match nothing"
        )
        expect(
          (await count({ key, expiresAt: second })) === 1,
          "a plain value must still compare for equality, not order"
        )
      } finally {
        await db.delete({ table: "attempts", where: { key } })
      }
    }
  },
  {
    name: "update applies the values it is given, and touches nothing else",
    async run(db) {
      const email = `${unique()}@example.test`
      const row = await create(db, "users", person({ email, name: "Ada" }))
      try {
        await db.update({
          table: "users",
          where: { id: row.id },
          values: { name: "Ada Lovelace" }
        })
        const [updated] = await db.select({
          table: "users",
          where: { email },
          limit: 10,
          orderBy: { id: "asc" }
        })

        expect(updated, "the row disappeared during an update")
        expect(
          updated?.name === "Ada Lovelace",
          "update did not apply its values"
        )
        expect(
          updated?.email === email,
          "update changed a column it was not given. Core sends only what changed, and expects the rest to survive."
        )
      } finally {
        await db.delete({ table: "users", where: { email } })
      }
    }
  },
  {
    name: "delete returns what it removed, and nothing when it matched nothing",
    async run(db) {
      const email = `${unique()}@example.test`
      await create(db, "users", person({ email }))

      const removed = await db.delete({ table: "users", where: { email } })
      expect(
        removed.length === 1 && removed[0]?.email === email,
        "delete must return the rows it removed. A single-use code is spent by this, and a revoke answers 404 from it — an empty return makes both fail open."
      )
      expect(
        (await db.delete({ table: "users", where: { email } })).length === 0,
        "delete matched nothing but did not return an empty result"
      )
    }
  },
  {
    name: "delete matches on every column, so someone else's id matches nothing",
    async run(db) {
      const owner = await create(
        db,
        "users",
        person({ email: `${unique()}@example.test` })
      )
      const stranger = await create(
        db,
        "users",
        person({ email: `${unique()}@example.test` })
      )
      const tokenHash = unique()
      const session = await create(db, "sessions", {
        userId: owner.id,
        tokenHash,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: future(),
        userAgent: null,
        ipAddress: null
      })
      try {
        expect(
          (
            await db.delete({
              table: "sessions",
              where: { id: session.id, userId: stranger.id }
            })
          ).length === 0,
          "a delete naming both id and userId removed a session belonging to someone else. That pair is what stops one signed-in person revoking another's devices."
        )
      } finally {
        await db.delete({ table: "sessions", where: { tokenHash } })
        await db.delete({ table: "users", where: { id: owner.id } })
        await db.delete({ table: "users", where: { id: stranger.id } })
      }
    }
  },
  {
    name: "users.email is unique",
    async run(db) {
      const email = `${unique()}@example.test`
      const first = await create(db, "users", person({ email }))
      try {
        await refuses(
          () => db.insert({ table: "users", values: person({ email }) }),
          "a second user was inserted with the same email. Core reads before it inserts, so this constraint is what decides the race between two first sign-ins — without it they become two accounts for one person."
        )
      } finally {
        await db.delete({ table: "users", where: { id: first.id } })
      }
    }
  },
  {
    name: "users.phoneNumber is unique",
    async run(db) {
      const phoneNumber = `+1555${Math.floor(Math.random() * 9_000_000) + 1_000_000}`
      const first = await create(db, "users", person({ phoneNumber }))
      try {
        await refuses(
          () => db.insert({ table: "users", values: person({ phoneNumber }) }),
          "a second user was inserted with the same phone number, so two sign-ins from one number can become two accounts"
        )
      } finally {
        await db.delete({ table: "users", where: { id: first.id } })
      }
    }
  },
  {
    name: "sessions.tokenHash is unique",
    async run(db) {
      const owner = await create(
        db,
        "users",
        person({ email: `${unique()}@example.test` })
      )
      const tokenHash = unique()
      const session = () => ({
        userId: owner.id,
        tokenHash,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: future(),
        userAgent: null,
        ipAddress: null
      })
      try {
        await create(db, "sessions", session())
        await refuses(
          () => db.insert({ table: "sessions", values: session() }),
          "two sessions were stored with the same token hash. One refresh token would then resolve to two rows, and revoking the session a browser holds would leave it signed in."
        )
      } finally {
        await db.delete({ table: "sessions", where: { tokenHash } })
        await db.delete({ table: "users", where: { id: owner.id } })
      }
    }
  },
  {
    name: "identities are unique on (provider, providerUserId)",
    async run(db) {
      const owner = await create(
        db,
        "users",
        person({ email: `${unique()}@example.test` })
      )
      const providerUserId = unique()
      const identity = () => ({
        userId: owner.id,
        provider: "github",
        providerUserId,
        label: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      try {
        await create(db, "identities", identity())
        await refuses(
          () => db.insert({ table: "identities", values: identity() }),
          "one provider account was linked twice. Core looks the pair up before it inserts, so two concurrent sign-ins both find nothing — this index is what refuses the loser."
        )
      } finally {
        await db.delete({ table: "identities", where: { providerUserId } })
        await db.delete({ table: "users", where: { id: owner.id } })
      }
    }
  },
  {
    name: "identitySecrets cascade when their identity is deleted",
    async run(db) {
      const owner = await create(
        db,
        "users",
        person({ email: `${unique()}@example.test` })
      )
      const providerUserId = unique()
      try {
        const identity = await create(db, "identities", {
          userId: owner.id,
          provider: "github",
          providerUserId,
          label: null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        await create(db, "identitySecrets", {
          identityId: identity.id,
          accessTokenEncrypted: "v1.ciphertext",
          refreshTokenEncrypted: "v1.ciphertext",
          createdAt: new Date(),
          updatedAt: new Date()
        })

        await db.delete({ table: "identities", where: { id: identity.id } })

        const orphaned = await db.select({
          table: "identitySecrets",
          where: { identityId: identity.id },
          limit: 1,
          orderBy: { createdAt: "asc" }
        })
        if (orphaned.length > 0) {
          throw new Error(
            "a provider's encrypted tokens outlived the identity that addressed them. Core deletes them itself, so this only fails where something else removes an identity — but an orphaned row is a stored credential nothing points at, and no policy can scope it."
          )
        }
      } finally {
        await db.delete({ table: "identities", where: { providerUserId } })
        await db.delete({ table: "users", where: { id: owner.id } })
      }
    }
  },
  {
    name: "delete honours a range, removing what has expired and keeping what has not",
    async run(db) {
      const identifier = `${unique()}@example.test`
      for (const expiresAt of [past(), future()]) {
        await create(db, "verifications", {
          identifier,
          codeHash: `${unique()}`,
          expiresAt,
          purpose: "signIn",
          createdAt: new Date(),
          updatedAt: new Date()
        })
      }
      try {
        const removed = await db.delete({
          table: "verifications",
          where: { identifier, expiresAt: { lt: new Date() } }
        })

        expect(
          removed.length === 1 &&
            removed[0] !== undefined &&
            removed[0].expiresAt.getTime() < Date.now(),
          "deleting where expiresAt is past must remove exactly the expired row. The sweep that keeps sessions, codes, and attempts from accumulating is this one delete."
        )

        const left = await db.select({
          table: "verifications",
          where: { identifier },
          limit: 10,
          orderBy: { id: "asc" }
        })
        expect(
          left.length === 1 &&
            left[0] !== undefined &&
            left[0].expiresAt.getTime() > Date.now(),
          "the delete removed the row that had not expired yet, signing people out early"
        )
      } finally {
        await db.delete({ table: "verifications", where: { identifier } })
      }
    }
  }
]
