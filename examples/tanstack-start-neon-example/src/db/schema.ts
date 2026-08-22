import type { MagicCodePurpose, UserType } from "@auth-ts/server"
import { sql } from "drizzle-orm"
import { authenticatedRole } from "drizzle-orm/neon"
import {
  boolean,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"

export const users = pgTable.withRLS("users", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  email: text("email").unique(),
  phoneNumber: text("phoneNumber").unique(),
  name: text("name"),
  imageURL: text("imageURL"),
  type: text("type").$type<UserType>().notNull().default("user"),
  primaryUserId: uuid("primaryUserId"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

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
    index("sessionsExpiresAtIndex").on(table.expiresAt)
  ]
)

export const magicCodes = pgTable.withRLS(
  "magicCodes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    identifier: text("identifier").notNull().unique(),
    codeHash: text("codeHash").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    purpose: text("purpose")
      .$type<MagicCodePurpose>()
      .notNull()
      .default("signIn"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [index("magicCodesExpiresAtIndex").on(table.expiresAt)]
)

export const rateLimits = pgTable.withRLS(
  "rateLimits",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    key: text("key").notNull().unique(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("resetAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [index("rateLimitsResetAtIndex").on(table.resetAt)]
)

export const connections = pgTable.withRLS(
  "connections",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    email: text("email"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    index("connectionsUserIdIndex").on(table.userId),
    // Unique, not merely indexed: `upsertConnection` names these two columns
    // as its ON CONFLICT target, which Postgres only accepts against a unique
    // index or constraint — and a provider identity belongs to one user.
    uniqueIndex("connectionsProviderAccountIndex").on(
      table.provider,
      table.providerAccountId
    )
  ]
)

export const todos = pgTable.withRLS(
  "todos",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("userId").notNull().default(sql`(auth.user_id()::uuid)`),
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
  () => [
    pgPolicy("own todos", {
      for: "all",
      to: authenticatedRole,
      using: sql`"userId" = (auth.user_id())::uuid`,
      withCheck: sql`"userId" = (auth.user_id())::uuid`
    })
  ]
)
