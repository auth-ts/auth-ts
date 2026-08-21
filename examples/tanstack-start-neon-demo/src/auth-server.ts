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
    await db.delete(users).where(eq(users.id, where.id))
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

    await db.delete(sessions).where(condition)
  },

  async deleteSessions(where) {
    const condition = where.exceptTokenHash
      ? and(
          eq(sessions.userId, where.userId),
          sql`${sessions.tokenHash} <> ${where.exceptTokenHash}`
        )
      : eq(sessions.userId, where.userId)

    await db.delete(sessions).where(condition)
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
    await db
      .delete(magicCodes)
      .where(eq(magicCodes.identifier, where.identifier))
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
    await db
      .insert(rateLimits)
      .values(rateLimit)
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: rateLimit.count,
          resetAt: rateLimit.resetAt,
          updatedAt: new Date()
        }
      })
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
    await db
      .delete(connections)
      .where(
        and(
          eq(connections.userId, where.userId),
          eq(connections.provider, where.provider)
        )
      )
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

const githubClientId = process.env.GITHUB_CLIENT_ID
const googleClientId = process.env.GOOGLE_CLIENT_ID

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
      console.log(
        `\n  ✉️  ${purpose === "deleteUser" ? "Deletion" : "Sign-in"} code for ${email}: ${code}\n`
      )
    }
  },
  guest: true,
  multiAccount: true,
  baseURL: process.env.AUTH_BASE_URL,
  cookie: { path: "/" },
  logLevel: "info",
  ...(githubClientId || googleClientId
    ? {
        providers: {
          ...(githubClientId
            ? {
                github: {
                  clientId: githubClientId,
                  clientSecret: process.env.GITHUB_CLIENT_SECRET ?? ""
                }
              }
            : {}),
          ...(googleClientId
            ? {
                google: {
                  clientId: googleClientId,
                  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
                }
              }
            : {})
        }
      }
    : {})
})

/** The type the browser client imports, type-only, to infer its own surface. */
export type AuthServer = typeof authServer
