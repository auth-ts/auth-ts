import type { OTPAction, UserType } from "@auth-ts/server"
import { sql } from "drizzle-orm"
import { authenticatedRole } from "drizzle-orm/neon"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  boolean,
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"

const authUuid = (userIdColumn: AnyPgColumn) =>
  sql`(select (auth.user_id())::uuid = ${userIdColumn})`

export const users = pgTable.withRLS(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    email: text("email").unique(),
    phoneNumber: text("phoneNumber").unique(),
    name: text("name"),
    imageURL: text("imageURL"),
    type: text("type").$type<UserType>().notNull().default("user"),
    primaryUserId: uuid("primaryUserId").references(
      (): AnyPgColumn => users.id,
      {
        onDelete: "cascade"
      }
    ),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    pgPolicy("selectOwnUser", {
      for: "select",
      to: authenticatedRole,
      using: authUuid(table.id)
    }),
    pgPolicy("updateOwnUser", {
      for: "update",
      to: authenticatedRole,
      using: authUuid(table.id),
      withCheck: authUuid(table.id)
    }),
    check("usersTypeCheck", sql`"type" in ('guest', 'user', 'admin')`)
  ]
)

export const sessions = pgTable.withRLS(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull().unique(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    userAgent: text("userAgent"),
    ipAddress: text("ipAddress"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    index("sessionsUserIdIndex").on(table.userId),
    index("sessionsExpiresAtIndex").on(table.expiresAt),
    pgPolicy("selectOwnSessions", {
      for: "select",
      to: authenticatedRole,
      using: authUuid(table.userId)
    }),
    pgPolicy("deleteOwnSessions", {
      for: "delete",
      to: authenticatedRole,
      using: authUuid(table.userId)
    })
  ]
)

export const otps = pgTable.withRLS(
  "otps",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    identifier: text("identifier").notNull(),
    codeHash: text("codeHash").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    action: text("action").$type<OTPAction>().notNull().default("signIn"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    index("otpsIdentifierIndex").on(table.identifier),
    index("otpsExpiresAtIndex").on(table.expiresAt),
    check("otpsActionCheck", sql`"action" in ('signIn', 'deleteUser')`)
  ]
)

export const attempts = pgTable.withRLS(
  "attempts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    key: text("key").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    index("attemptsKeyIndex").on(table.key),
    index("attemptsExpiresAtIndex").on(table.expiresAt)
  ]
)

export const identities = pgTable.withRLS(
  "identities",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("providerUserId").notNull(),
    label: text("label"),
    // Encrypted by the library before they ever arrive here, and revoked from
    // the Data API role in privileges.sql — a connected account's credentials
    // have no business in a browser, ciphertext or not.
    accessToken: text("accessToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
      withTimezone: true
    }),
    refreshToken: text("refreshToken"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
      withTimezone: true
    }),
    scope: text("scope"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    index("identitiesUserIdIndex").on(table.userId),
    uniqueIndex("identitiesProviderUserIndex").on(
      table.provider,
      table.providerUserId
    ),
    pgPolicy("selectOwnIdentities", {
      for: "select",
      to: authenticatedRole,
      using: authUuid(table.userId)
    }),
    pgPolicy("deleteOwnIdentities", {
      for: "delete",
      to: authenticatedRole,
      using: authUuid(table.userId)
    })
  ]
)

export const todos = pgTable.withRLS(
  "todos",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("userId")
      .notNull()
      .default(sql`cast(auth.user_id() as uuid)`)
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: boolean("completed").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    pgPolicy("manageOwnTodos", {
      for: "all",
      to: authenticatedRole,
      using: authUuid(table.userId),
      withCheck: authUuid(table.userId)
    })
  ]
)

export type Todo = typeof todos.$inferSelect
export type TodoInsert = typeof todos.$inferInsert
