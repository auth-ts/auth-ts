import type {
  AuthConnection,
  AuthDB,
  AuthMagicCode,
  AuthRateLimit,
  AuthSession,
  AuthUser,
  DeleteSessionWhere,
  GetUserWhere,
  UpsertConnectionInput,
  UpsertMagicCodeInput,
  UpsertSessionInput,
  UpsertUserInput
} from "../core/auth-db.ts"
import { randomUUID } from "./generate-random.ts"

/** An in-memory {@link AuthDB} plus a few helpers for inspecting it in tests. */
export interface MemoryDb extends AuthDB {
  /** Every stored user, in insertion order. */
  users(): AuthUser[]
  /** Every stored session, in insertion order. */
  sessions(): AuthSession[]
  /** Empties every table. */
  reset(): void
}

/** A user row plus whatever additional fields the consumer declared. */
type StoredUser = AuthUser & Record<string, unknown>

/**
 * Creates a fully in-memory implementation of the database contract.
 *
 * This is public API, exported as `@auth-ts/server/testing`, on purpose: the
 * library's own suite runs against this exact object, so when you test your auth
 * flows against it you are testing against the same semantics the library
 * verifies itself with — not a simplified mock that agrees with your assumptions.
 *
 * It implements the documented upsert behaviour precisely, including the parts
 * that are easy to get wrong in a real adapter: `type` applied on insert only,
 * identifier-keyed versus id-targeted writes, and deletes that cascade to
 * sessions.
 */
export function createMemoryDb(): MemoryDb {
  const users = new Map<string, StoredUser>()
  const sessions = new Map<string, AuthSession>()
  const magicCodes = new Map<string, AuthMagicCode>()
  const rateLimits = new Map<string, AuthRateLimit>()
  const connections = new Map<string, AuthConnection>()

  const connectionKey = (provider: string, providerAccountId: string) =>
    `${provider}:${providerAccountId}`

  const findUserByIdentifier = (email?: string, phoneNumber?: string) => {
    for (const user of users.values()) {
      if (email !== undefined && user.email === email) return user
      if (phoneNumber !== undefined && user.phoneNumber === phoneNumber)
        return user
    }
    return undefined
  }

  /**
   * Copies only the keys that were actually provided, so undefined means "leave alone".
   *
   * `applyAdditionalFields` is false on the identifier-keyed path: that is a
   * sign-in, and letting a sign-in body rewrite profile columns would be mass
   * assignment. The id-targeted path sets it, because that is how PATCH edits.
   */
  const mergeDefined = (
    target: StoredUser,
    input: UpsertUserInput,
    applyAdditionalFields: boolean
  ) => {
    const { id, type, additionalFields, ...fields } = input
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) target[key] = value
    }
    if (applyAdditionalFields && additionalFields)
      Object.assign(target, additionalFields)
  }

  return {
    async upsertUser(input) {
      if (input.id !== undefined) {
        const existing = users.get(input.id)
        if (!existing) throw new Error(`No user with id ${input.id}`)

        mergeDefined(existing, input, true)
        // The one place type may change: core converting a guest into a real user.
        if (input.type === "user" && existing.type === "guest")
          existing.type = "user"
        if (input.primaryUserId !== undefined)
          existing.primaryUserId = input.primaryUserId

        return { ...existing }
      }

      const existing = findUserByIdentifier(input.email, input.phoneNumber)
      if (existing) {
        // type and additionalFields are both insert-only here: otherwise every
        // admin would be demoted on their next sign-in, and any sign-in body
        // could overwrite profile columns.
        mergeDefined(existing, input, false)
        return { ...existing }
      }

      const created: StoredUser = {
        id: randomUUID(),
        email: input.email ?? null,
        phoneNumber: input.phoneNumber ?? null,
        name: input.name ?? null,
        imageURL: input.imageURL ?? null,
        type: input.type ?? "user",
        primaryUserId: input.primaryUserId ?? null,
        ...(input.additionalFields ?? {})
      }
      users.set(created.id, created)

      return { ...created }
    },

    async getUser(where: GetUserWhere) {
      if ("id" in where) {
        const user = users.get(where.id)
        return user ? { ...user } : null
      }

      const user =
        "email" in where
          ? findUserByIdentifier(where.email)
          : findUserByIdentifier(undefined, where.phoneNumber)

      return user ? { ...user } : null
    },

    async deleteUser(where) {
      const user = users.get(where.id)
      users.delete(where.id)
      // Contract: a deleted account must not keep a live refresh token.
      for (const [tokenHash, session] of sessions) {
        if (session.userId === where.id) sessions.delete(tokenHash)
      }
      for (const [key, connection] of connections) {
        if (connection.userId === where.id) connections.delete(key)
      }
      return user ? { ...user } : null
    },

    async upsertSession(session: UpsertSessionInput) {
      const existing = sessions.get(session.tokenHash)
      sessions.set(session.tokenHash, {
        ...session,
        // createdAt is authentication time: a refresh slides expiry, never this.
        createdAt: existing?.createdAt ?? session.createdAt,
        userAgent: session.userAgent ?? null,
        ipAddress: session.ipAddress ?? null
      })
    },

    async getSession(where) {
      const session = sessions.get(where.tokenHash)
      return session ? { ...session } : null
    },

    async listSessions(where) {
      return [...sessions.values()]
        .filter((session) => session.userId === where.userId)
        .map((session) => ({ ...session }))
    },

    async deleteSession(where: DeleteSessionWhere) {
      if ("tokenHash" in where) {
        const session = sessions.get(where.tokenHash)
        sessions.delete(where.tokenHash)
        return session ? { ...session } : null
      }

      for (const [tokenHash, session] of sessions) {
        // Ownership is part of the query, so another user's id matches nothing.
        if (session.id === where.id && session.userId === where.userId) {
          sessions.delete(tokenHash)
          return { ...session }
        }
      }
      return null
    },

    async deleteSessions(where) {
      const deleted: AuthSession[] = []
      for (const [tokenHash, session] of sessions) {
        if (session.userId !== where.userId) continue
        if (
          where.exceptTokenHash !== undefined &&
          tokenHash === where.exceptTokenHash
        )
          continue
        sessions.delete(tokenHash)
        deleted.push({ ...session })
      }
      return deleted
    },

    async upsertMagicCode(magicCode: UpsertMagicCodeInput) {
      magicCodes.set(magicCode.identifier, { ...magicCode })
    },

    async getMagicCode(where) {
      const magicCode = magicCodes.get(where.identifier)
      return magicCode ? { ...magicCode } : null
    },

    async deleteMagicCode(where) {
      const magicCode = magicCodes.get(where.identifier)
      // The hash is part of the match, so a stale code cannot consume a row a
      // resend has since replaced, and only one of two racing consumers wins.
      if (!magicCode) return null
      if (where.codeHash !== undefined && magicCode.codeHash !== where.codeHash)
        return null

      magicCodes.delete(where.identifier)
      return { ...magicCode }
    },

    async getRateLimit(where) {
      const rateLimit = rateLimits.get(where.key)
      return rateLimit ? { ...rateLimit } : null
    },

    async upsertRateLimit(rateLimit) {
      const existing = rateLimits.get(rateLimit.key)
      // Same branch the SQL takes: a fresh window when the key is absent or its
      // window has passed, otherwise one more on the existing count with the
      // existing resetAt kept. Single-threaded here, so trivially atomic.
      const next: AuthRateLimit =
        !existing || existing.resetAt.getTime() <= Date.now()
          ? { key: rateLimit.key, count: 1, resetAt: rateLimit.resetAt }
          : { ...existing, count: existing.count + 1 }

      rateLimits.set(rateLimit.key, next)
      return { ...next }
    },

    async upsertConnection(connection: UpsertConnectionInput) {
      connections.set(
        connectionKey(connection.provider, connection.providerAccountId),
        {
          ...connection,
          email: connection.email ?? null
        }
      )
    },

    async getConnection(where) {
      const connection = connections.get(
        connectionKey(where.provider, where.providerAccountId)
      )
      return connection ? { ...connection } : null
    },

    async listConnections(where) {
      return [...connections.values()]
        .filter((connection) => connection.userId === where.userId)
        .map((connection) => ({ ...connection }))
    },

    async deleteConnection(where) {
      for (const [key, connection] of connections) {
        if (
          connection.userId === where.userId &&
          connection.provider === where.provider
        ) {
          connections.delete(key)
          return { ...connection }
        }
      }
      return null
    },

    async deleteExpired() {
      const now = new Date()

      for (const [identifier, magicCode] of magicCodes) {
        if (magicCode.expiresAt < now) magicCodes.delete(identifier)
      }
      for (const [tokenHash, session] of sessions) {
        if (session.expiresAt < now) sessions.delete(tokenHash)
      }
      for (const [key, rateLimit] of rateLimits) {
        if (rateLimit.resetAt < now) rateLimits.delete(key)
      }
    },

    users: () => [...users.values()].map((user) => ({ ...user })),
    sessions: () => [...sessions.values()].map((session) => ({ ...session })),
    reset() {
      users.clear()
      sessions.clear()
      magicCodes.clear()
      rateLimits.clear()
      connections.clear()
    }
  }
}
