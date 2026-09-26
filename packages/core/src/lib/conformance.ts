import type {
  AdditionalFieldsSchema,
  AuthDatabase,
  AuthInsert,
  AuthRow,
  AuthTable,
  AuthWhere
} from "../core/auth-database"

/** One requirement of the contract, and a way to find out whether it holds. */
export interface AuthDatabaseCheck {
  name: string
  run(db: AuthDatabase): Promise<void>
}

/** Fails the check, saying what the contract asked for and why it matters. */
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Inserts, and holds the store to its side of the bargain: it returns the row. */
async function create<T extends AuthTable>(
  db: AuthDatabase,
  table: T,
  values: AuthInsert<"date", AdditionalFieldsSchema, T>
): Promise<AuthRow<"date", AdditionalFieldsSchema, T>> {
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

/** A verification row that only varies in when it was created. */
const code = (identifier: string, createdAt = new Date()) => ({
  identifier,
  codeHash: unique(),
  attemptHash: unique(),
  purpose: "signIn" as const,
  createdAt,
  updatedAt: new Date()
})

/** A rate-limit bucket with one token spent. */
const bucket = (key: string) => ({
  key,
  tokenCount: 4,
  lastRefilledAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date()
})

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

/** Runs a check against a fresh user, removed afterwards whatever happens. */
async function withUser(
  db: AuthDatabase,
  run: (
    user: AuthRow<"date", AdditionalFieldsSchema, "users">
  ) => Promise<void>,
  fields: Record<string, unknown> = {}
) {
  const user = await create(
    db,
    "users",
    person({ email: `${unique()}@example.test`, ...fields })
  )
  try {
    await run(user)
  } finally {
    await db.delete({ table: "users", where: { id: { eq: user.id } } })
  }
}

const session = (userId: string, secretHash: string) => ({
  userId,
  secretHash,
  createdAt: new Date(),
  updatedAt: new Date(),
  userAgent: null,
  ipAddress: null
})

const identity = (userId: string, providerUserId: string) => ({
  userId,
  provider: "github",
  providerUserId,
  label: null,
  createdAt: new Date(),
  updatedAt: new Date()
})

/** Whether these rows came back at exactly these times, in exactly this order. */
function ordered(rows: { createdAt: Date }[], times: number[]) {
  return (
    rows.length === times.length &&
    rows.every((row, index) => row.createdAt.getTime() === times[index])
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
 * import { authDatabaseChecks } from "@auth-ts/core/testing"
 * import { authDatabase } from "./auth-database"
 *
 * describe("authDatabase", () => {
 *   for (const check of authDatabaseChecks) {
 *     it(check.name, () => check.run(authDatabase))
 *   }
 * })
 * ```
 */
export const authDatabaseChecks: AuthDatabaseCheck[] = [
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
        await db.delete({ table: "users", where: { email: { eq: email } } })
      }
    }
  },
  {
    name: "select matches on every column given, and only on equality",
    async run(db) {
      const email = `${unique()}@example.test`
      await withUser(
        db,
        async () => {
          const matching = (name: string) =>
            db.select({
              table: "users",
              where: { email: { eq: email }, name: { eq: name } },
              limit: 10,
              orderBy: { id: "asc" }
            })

          expect(
            (await matching("Ada")).length === 1,
            "a where naming two columns did not match the row that has both"
          )
          expect(
            (await matching("Grace")).length === 0,
            "every column in a where has to match. This one matched a row on some of them, which would let one person's code verify against another's identifier."
          )
        },
        { email, name: "Ada" }
      )
    }
  },
  {
    name: "select honours limit and both directions of orderBy",
    async run(db) {
      const identifier = `${unique()}@example.test`
      const times = [3, 1, 2].map(
        (minutes) => new Date(Date.now() + minutes * 60_000)
      )
      for (const createdAt of times) {
        await create(db, "verifications", code(identifier, createdAt))
      }
      try {
        const page = (direction: "asc" | "desc", limit: number) =>
          db.select({
            table: "verifications",
            where: { identifier: { eq: identifier } },
            limit,
            orderBy: { createdAt: direction }
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
        await db.delete({
          table: "verifications",
          where: { identifier: { eq: identifier } }
        })
      }
    }
  },
  {
    name: "update returns the rows it changed",
    run: (db) =>
      withUser(
        db,
        async (row) => {
          const changed = await db.update({
            table: "users",
            where: { id: { eq: row.id } },
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
                where: { id: { eq: crypto.randomUUID() } },
                values: { name: "nobody" }
              })
            ).length === 0,
            "update matched nothing but did not report an empty result"
          )
        },
        { name: "Ada" }
      )
  },
  {
    name: "a range matches on order, and only within its bounds",
    async run(db) {
      const identifier = `${unique()}@example.test`
      const times = [1, 2, 3].map(
        (minutes) => new Date(Date.now() + minutes * 60_000)
      )
      for (const createdAt of times) {
        await create(db, "verifications", code(identifier, createdAt))
      }
      const [first, second, third] = times as [Date, Date, Date]
      try {
        const count = async (
          where: AuthWhere<"date", AdditionalFieldsSchema, "verifications">
        ) =>
          (
            await db.select({
              table: "verifications",
              where,
              limit: 10,
              orderBy: { createdAt: "asc" }
            })
          ).length

        expect(
          (await count({
            identifier: { eq: identifier },
            createdAt: { gt: second }
          })) === 1,
          "gt must exclude its own bound and everything below it"
        )
        expect(
          (await count({
            identifier: { eq: identifier },
            createdAt: { lt: second }
          })) === 1,
          "lt must exclude its own bound and everything above it"
        )
        expect(
          (await count({
            identifier: { eq: identifier },
            createdAt: { gt: first, lt: third }
          })) === 1,
          "lt and gt together must bound both ends"
        )
        expect(
          (await count({
            identifier: { eq: identifier },
            createdAt: { gt: third }
          })) === 0,
          "a range past every row must match nothing"
        )
        expect(
          (await count({
            identifier: { eq: identifier },
            createdAt: { eq: second }
          })) === 1,
          "eq on createdAt must still compare for equality, not order"
        )
      } finally {
        await db.delete({
          table: "verifications",
          where: { identifier: { eq: identifier } }
        })
      }
    }
  },
  {
    name: "update applies the values it is given, and touches nothing else",
    async run(db) {
      const email = `${unique()}@example.test`
      await withUser(
        db,
        async (row) => {
          await db.update({
            table: "users",
            where: { id: { eq: row.id } },
            values: { name: "Ada Lovelace" }
          })
          const [updated] = await db.select({
            table: "users",
            where: { email: { eq: email } },
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
        },
        { email, name: "Ada" }
      )
    }
  },
  {
    name: "delete returns what it removed, and nothing when it matched nothing",
    async run(db) {
      const email = `${unique()}@example.test`
      await create(db, "users", person({ email }))

      const removed = await db.delete({
        table: "users",
        where: { email: { eq: email } }
      })
      expect(
        removed.length === 1 && removed[0]?.email === email,
        "delete must return the rows it removed. A single-use code is spent by this, and a revoke answers 404 from it — an empty return makes both fail open."
      )
      expect(
        (await db.delete({ table: "users", where: { email: { eq: email } } }))
          .length === 0,
        "delete matched nothing but did not return an empty result"
      )
    }
  },
  {
    name: "delete matches on every column, so someone else's id matches nothing",
    run: (db) =>
      withUser(db, (owner) =>
        withUser(db, async (stranger) => {
          const held = await create(db, "sessions", session(owner.id, unique()))
          try {
            expect(
              (
                await db.delete({
                  table: "sessions",
                  where: { id: { eq: held.id }, userId: { eq: stranger.id } }
                })
              ).length === 0,
              "a delete naming both id and userId removed a session belonging to someone else. That pair is what stops one signed-in person revoking another's devices."
            )
          } finally {
            await db.delete({
              table: "sessions",
              where: { id: { eq: held.id } }
            })
          }
        })
      )
  },
  {
    name: "users.email is unique",
    async run(db) {
      const email = `${unique()}@example.test`
      await withUser(
        db,
        () =>
          refuses(
            () => db.insert({ table: "users", values: person({ email }) }),
            "a second user was inserted with the same email. Core reads before it inserts, so this constraint is what decides the race between two first sign-ins — without it they become two accounts for one person."
          ),
        { email }
      )
    }
  },
  {
    name: "rateLimits.key is unique",
    async run(db) {
      const key = unique()
      await create(db, "rateLimits", bucket(key))
      try {
        await refuses(
          () => db.insert({ table: "rateLimits", values: bucket(key) }),
          "two buckets were stored under one key. Two first requests on a fresh key both find nothing and both insert; this constraint is what makes the loser read again instead of starting a second bucket."
        )
      } finally {
        await db.delete({ table: "rateLimits", where: { key: { eq: key } } })
      }
    }
  },
  {
    name: "update matches on every column it is given, so a stale bucket write changes nothing",
    async run(db) {
      const seen = await create(db, "rateLimits", bucket(unique()))
      try {
        await db.update({
          table: "rateLimits",
          where: { id: { eq: seen.id } },
          values: { tokenCount: 3 }
        })
        const stale = await db.update({
          table: "rateLimits",
          where: {
            id: { eq: seen.id },
            tokenCount: { eq: 4 },
            lastRefilledAt: { eq: seen.lastRefilledAt }
          },
          values: { tokenCount: 3 }
        })
        expect(
          stale.length === 0,
          "an update naming tokenCount matched a row whose tokenCount had moved on. A token is taken by writing only if the row is as it was read; a stale write that lands hands the same token out twice."
        )
      } finally {
        await db.delete({ table: "rateLimits", where: { id: { eq: seen.id } } })
      }
    }
  },
  {
    name: "users.phoneNumber is unique",
    async run(db) {
      const phoneNumber = `+1555${Math.floor(Math.random() * 9_000_000) + 1_000_000}`
      await withUser(
        db,
        () =>
          refuses(
            () =>
              db.insert({ table: "users", values: person({ phoneNumber }) }),
            "a second user was inserted with the same phone number, so two sign-ins from one number can become two accounts"
          ),
        { phoneNumber }
      )
    }
  },
  {
    name: "identities are unique on (provider, providerUserId)",
    run: (db) =>
      withUser(db, async (owner) => {
        const providerUserId = unique()
        try {
          await create(db, "identities", identity(owner.id, providerUserId))
          await refuses(
            () =>
              db.insert({
                table: "identities",
                values: identity(owner.id, providerUserId)
              }),
            "one provider account was linked twice. Core looks the pair up before it inserts, so two concurrent sign-ins both find nothing — this index is what refuses the loser."
          )
        } finally {
          await db.delete({
            table: "identities",
            where: { providerUserId: { eq: providerUserId } }
          })
        }
      })
  },
  {
    name: "identitySecrets cascade when their identity is deleted",
    run: (db) =>
      withUser(db, async (owner) => {
        const providerUserId = unique()
        try {
          const linked = await create(
            db,
            "identities",
            identity(owner.id, providerUserId)
          )
          await create(db, "identitySecrets", {
            identityId: linked.id,
            accessToken: "provider-access-token",
            refreshToken: "provider-refresh-token",
            createdAt: new Date(),
            updatedAt: new Date()
          })

          await db.delete({
            table: "identities",
            where: { id: { eq: linked.id } }
          })

          const orphaned = await db.select({
            table: "identitySecrets",
            where: { identityId: { eq: linked.id } },
            limit: 1,
            orderBy: { createdAt: "asc" }
          })
          if (orphaned.length > 0) {
            throw new Error(
              "a provider's tokens outlived the identity that addressed them. Core deletes them itself, so this only fails where something else removes an identity — but an orphaned row is a stored credential nothing points at, and no policy can scope it."
            )
          }
        } finally {
          await db.delete({
            table: "identities",
            where: { providerUserId: { eq: providerUserId } }
          })
        }
      })
  },
  {
    name: "delete honours a range, removing what has expired and keeping what has not",
    async run(db) {
      const identifier = `${unique()}@example.test`
      for (const updatedAt of [past(), future()]) {
        await create(db, "verifications", {
          identifier,
          codeHash: `${unique()}`,
          attemptHash: `${unique()}`,
          purpose: "signIn",
          createdAt: new Date(),
          updatedAt
        })
      }
      try {
        const removed = await db.delete({
          table: "verifications",
          where: {
            identifier: { eq: identifier },
            updatedAt: { lt: new Date() }
          }
        })

        expect(
          removed.length === 1 &&
            removed[0] !== undefined &&
            removed[0].updatedAt.getTime() < Date.now(),
          "deleting where updatedAt is past a bound must remove exactly the old row. The sweep that keeps sessions, codes, and rate-limit buckets from accumulating is this one delete."
        )

        const left = await db.select({
          table: "verifications",
          where: { identifier: { eq: identifier } },
          limit: 10,
          orderBy: { id: "asc" }
        })
        expect(
          left.length === 1 &&
            left[0] !== undefined &&
            left[0].updatedAt.getTime() > Date.now(),
          "the delete removed the row that had not expired yet, signing people out early"
        )
      } finally {
        await db.delete({
          table: "verifications",
          where: { identifier: { eq: identifier } }
        })
      }
    }
  }
]
