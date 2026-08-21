import type { AuthDb } from "@auth-ts/server"
import { createAuthServer } from "@auth-ts/server"
import { and, eq, lt, sql } from "drizzle-orm"
import { db } from "./db/client.ts"
import {
  connections,
  magicCodes,
  rateLimits,
  sessions,
  users
} from "./db/schema.ts"

/**
 * The database callbacks.
 *
 * This is the whole integration: no adapter, no generated code, just the queries
 * you would have written anyway. Each one is `ON CONFLICT`, so create-or-merge
 * stays a single atomic statement rather than a read followed by a write.
 */
const authDb: AuthDb = {
  async upsertUser(user) {
    // Id-targeted: update exactly this row. Guest conversion, and PATCH.
    if (user.id) {
      const [updated] = await db
        .update(users)
        .set({
          ...(user.email === undefined ? {} : { email: user.email }),
          ...(user.phoneNumber === undefined
            ? {}
            : { phoneNumber: user.phoneNumber }),
          ...(user.name === undefined ? {} : { name: user.name }),
          ...(user.imageURL === undefined ? {} : { imageURL: user.imageURL }),
          ...(user.primaryUserId === undefined
            ? {}
            : { primaryUserId: user.primaryUserId }),
          // The one type change core makes: a guest becoming a real user.
          ...(user.type === "user" ? { type: "user" } : {}),
          ...(user.additionalFields ?? {})
        })
        .where(eq(users.id, user.id))
        .returning()

      if (!updated) throw new Error(`No user with id ${user.id}`)
      return updated
    }

    // No identifier at all: always insert. This is guest creation.
    if (!user.email && !user.phoneNumber) {
      const [created] = await db
        .insert(users)
        .values({
          type: user.type ?? "guest",
          ...(user.additionalFields ?? {})
        })
        .returning()

      if (!created) throw new Error("Failed to create user")
      return created
    }

    // Identifier-keyed: insert, or merge into whoever owns that identifier.
    // `type` and additionalFields are omitted from the update on purpose — this
    // path is a sign-in, and a sign-in must not rewrite a profile or demote an
    // administrator.
    const target = user.email ? users.email : users.phoneNumber
    const [upserted] = await db
      .insert(users)
      .values({
        ...(user.email ? { email: user.email } : {}),
        ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
        ...(user.name ? { name: user.name } : {}),
        ...(user.imageURL ? { imageURL: user.imageURL } : {}),
        type: user.type ?? "user",
        ...(user.additionalFields ?? {})
      })
      .onConflictDoUpdate({
        target,
        set: {
          ...(user.name ? { name: user.name } : {}),
          ...(user.imageURL ? { imageURL: user.imageURL } : {}),
          updatedAt: new Date()
        }
      })
      .returning()

    if (!upserted) throw new Error("Failed to upsert user")
    return upserted
  },

  async getUser(where) {
    const condition =
      "id" in where
        ? eq(users.id, where.id)
        : "email" in where
          ? eq(users.email, where.email)
          : eq(users.phoneNumber, where.phoneNumber)

    const [user] = await db.select().from(users).where(condition).limit(1)
    return user ?? null
  },

  async deleteUser(where) {
    // Sessions and connections cascade via the foreign keys, which satisfies the
    // contract that a deleted account cannot keep a live refresh token.
    const [deleted] = await db
      .delete(users)
      .where(eq(users.id, where.id))
      .returning()
    return deleted ?? null
  },

  async upsertSession(session) {
    await db
      .insert(sessions)
      .values({
        id: session.id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        userAgent: session.userAgent ?? null,
        ipAddress: session.ipAddress ?? null
      })
      .onConflictDoUpdate({
        target: sessions.tokenHash,
        // createdAt is deliberately absent: it records when identity was proven,
        // and account deletion reads it. Sliding it would make an old browser
        // window look freshly authenticated.
        set: {
          expiresAt: session.expiresAt,
          userAgent: session.userAgent ?? null,
          ipAddress: session.ipAddress ?? null,
          updatedAt: new Date()
        }
      })
  },

  async getSession(where) {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, where.tokenHash))
      .limit(1)
    return session ?? null
  },

  async listSessions(where) {
    return db.select().from(sessions).where(eq(sessions.userId, where.userId))
  },

  async deleteSession(where) {
    // Ownership is part of the query, so another user's id matches no rows.
    const condition =
      "tokenHash" in where
        ? eq(sessions.tokenHash, where.tokenHash)
        : and(eq(sessions.id, where.id), eq(sessions.userId, where.userId))

    const [deleted] = await db.delete(sessions).where(condition).returning()
    return deleted ?? null
  },

  async deleteSessions(where) {
    const condition = where.exceptTokenHash
      ? and(
          eq(sessions.userId, where.userId),
          sql`${sessions.tokenHash} <> ${where.exceptTokenHash}`
        )
      : eq(sessions.userId, where.userId)

    return db.delete(sessions).where(condition).returning()
  },

  async upsertMagicCode(magicCode) {
    await db
      .insert(magicCodes)
      .values(magicCode)
      .onConflictDoUpdate({
        target: magicCodes.identifier,
        set: {
          codeHash: magicCode.codeHash,
          expiresAt: magicCode.expiresAt,
          attempts: magicCode.attempts,
          purpose: magicCode.purpose,
          updatedAt: new Date()
        }
      })
  },

  async getMagicCode(where) {
    const [magicCode] = await db
      .select()
      .from(magicCodes)
      .where(eq(magicCodes.identifier, where.identifier))
      .limit(1)

    return magicCode
      ? { ...magicCode, purpose: magicCode.purpose as "signIn" | "deleteUser" }
      : null
  },

  async deleteMagicCode(where) {
    // One conditional DELETE … RETURNING is the whole one-time guarantee: two
    // racing consumers both pass the HMAC check, but Postgres lets exactly one
    // of them delete the row. The other gets nothing back and is rejected.
    const condition = where.codeHash
      ? and(
          eq(magicCodes.identifier, where.identifier),
          eq(magicCodes.codeHash, where.codeHash)
        )
      : eq(magicCodes.identifier, where.identifier)

    const [deleted] = await db.delete(magicCodes).where(condition).returning()
    return deleted ?? null
  },

  async getRateLimit(where) {
    const [rateLimit] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, where.key))
      .limit(1)
    return rateLimit ?? null
  },

  async upsertRateLimit(rateLimit) {
    // One atomic statement is the whole limiter: a burst of parallel requests
    // each gets its own count, instead of all reading the same value and each
    // writing back count + 1. The window reset lives in the same statement
    // because it has the same race.
    const windowPassed = sql`${rateLimits.resetAt} <= now()`
    const [counted] = await db
      .insert(rateLimits)
      .values({ key: rateLimit.key, count: 1, resetAt: rateLimit.resetAt })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${windowPassed} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          resetAt: sql`CASE WHEN ${windowPassed} THEN excluded."resetAt" ELSE ${rateLimits.resetAt} END`,
          updatedAt: new Date()
        }
      })
      .returning()

    if (!counted) throw new Error("upsertRateLimit returned no row")
    return counted
  },

  async upsertConnection(connection) {
    await db
      .insert(connections)
      .values({ ...connection, email: connection.email ?? null })
      .onConflictDoUpdate({
        target: [connections.provider, connections.providerAccountId],
        set: { email: connection.email ?? null, updatedAt: new Date() }
      })
  },

  async getConnection(where) {
    const [connection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.provider, where.provider),
          eq(connections.providerAccountId, where.providerAccountId)
        )
      )
      .limit(1)

    return connection ?? null
  },

  async listConnections(where) {
    return db
      .select()
      .from(connections)
      .where(eq(connections.userId, where.userId))
  },

  async deleteConnection(where) {
    const [deleted] = await db
      .delete(connections)
      .where(
        and(
          eq(connections.userId, where.userId),
          eq(connections.provider, where.provider)
        )
      )
      .returning()
    return deleted ?? null
  },

  async deleteExpired() {
    // `now()` is the database's clock, which is the point of the callback taking
    // no argument: no skew between this process and Postgres.
    await Promise.all([
      db.delete(magicCodes).where(lt(magicCodes.expiresAt, sql`now()`)),
      db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`)),
      db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now()`))
    ])
  }
}

/**
 * The demo's auth server.
 *
 * `cookie.path` is `"/"` because the loaders read the session during
 * server-side rendering, which is the one case that needs it — with the
 * default the cookie is scoped to the auth mount and page requests carry
 * nothing.
 */
export const authServer = createAuthServer({
  db: authDb,
  email: {
    // The console transport. Swapping in a real provider is one fetch call here
    // and nothing else — the library never sees your email vendor.
    sendCode: ({ email, code, purpose }) => {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "The console email transport must not run in production. Replace sendCode with a real email provider."
        )
      }
      console.log(
        `\n  ✉️  ${purpose === "deleteUser" ? "Deletion" : "Sign-in"} code for ${email}: ${code}\n`
      )
    }
  },
  guest: true,
  multiAccount: true,
  // How many proxies sit between the public internet and this app. This is a
  // fact about the deployment, not a constant to ship: Vercel and most PaaS put
  // one in front of you; a bare `bun run start` has none. Declare too many and
  // the entry picked from X-Forwarded-For is one the client wrote, which lets
  // it choose its own rate-limit key. Unset means 0, which leaves per-IP
  // limiting off rather than keying it on a spoofable header — see
  // ClientIpOptions.trustedProxies. A non-integer here fails at startup.
  clientIp: {
    trustedProxies: process.env.AUTH_TRUSTED_PROXIES
      ? Number(process.env.AUTH_TRUSTED_PROXIES)
      : 0
  },
  baseURL: process.env.AUTH_BASE_URL as string,
  cookie: { path: "/" },
  logLevel: "info",
  providers: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string
    }
  }
})

/** The type the browser client imports, type-only, to infer its own surface. */
export type AuthServer = typeof authServer
