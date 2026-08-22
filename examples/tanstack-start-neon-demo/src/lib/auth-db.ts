import type { AuthDB } from "@auth-ts/server"
import { and, eq, lt, ne, sql } from "drizzle-orm"
import { db } from "../db/db"
import {
  connections,
  magicCodes,
  rateLimits,
  sessions,
  users
} from "../db/schema"

export const authDB: AuthDB = {
  async upsertUser({ id, ...user }) {
    const [upserted] = await db
      .insert(users)
      .values({ id, ...user })
      .onConflictDoUpdate({
        target: id ? users.id : user.email ? users.email : users.phoneNumber,
        // Merging by identifier is a sign-in: only the profile fields move.
        set: id ? user : { name: user.name, imageURL: user.imageURL }
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
    const [deleted] = await db
      .delete(users)
      .where(eq(users.id, where.id))
      .returning()
    return deleted ?? null
  },

  async upsertSession(session) {
    await db
      .insert(sessions)
      .values(session)
      .onConflictDoUpdate({
        target: sessions.tokenHash,
        set: {
          expiresAt: session.expiresAt,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress
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
    const condition =
      "tokenHash" in where
        ? eq(sessions.tokenHash, where.tokenHash)
        : and(eq(sessions.id, where.id), eq(sessions.userId, where.userId))

    const [deleted] = await db.delete(sessions).where(condition).returning()
    return deleted ?? null
  },

  async deleteSessions(where) {
    return db
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, where.userId),
          where.exceptTokenHash
            ? ne(sessions.tokenHash, where.exceptTokenHash)
            : undefined
        )
      )
      .returning()
  },

  async upsertMagicCode(magicCode) {
    await db
      .insert(magicCodes)
      .values(magicCode)
      .onConflictDoUpdate({ target: magicCodes.identifier, set: magicCode })
  },

  async getMagicCode(where) {
    const [magicCode] = await db
      .select()
      .from(magicCodes)
      .where(eq(magicCodes.identifier, where.identifier))
      .limit(1)
    return magicCode ?? null
  },

  async deleteMagicCode(where) {
    const [deleted] = await db
      .delete(magicCodes)
      .where(
        and(
          eq(magicCodes.identifier, where.identifier),
          where.codeHash ? eq(magicCodes.codeHash, where.codeHash) : undefined
        )
      )
      .returning()
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
    const windowPassed = sql`${rateLimits.resetAt} <= now()`
    const [counted] = await db
      .insert(rateLimits)
      .values({ ...rateLimit, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${windowPassed} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          resetAt: sql`CASE WHEN ${windowPassed} THEN excluded."resetAt" ELSE ${rateLimits.resetAt} END`
        }
      })
      .returning()

    if (!counted) throw new Error("Failed to upsert rate limit")
    return counted
  },

  async upsertConnection(connection) {
    await db
      .insert(connections)
      .values(connection)
      .onConflictDoUpdate({
        target: [connections.provider, connections.providerAccountId],
        set: { email: connection.email }
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
    await Promise.all([
      db.delete(magicCodes).where(lt(magicCodes.expiresAt, sql`now()`)),
      db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`)),
      db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now()`))
    ])
  }
}
