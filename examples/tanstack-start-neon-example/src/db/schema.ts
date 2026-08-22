import type { UserType, VerificationCodePurpose } from "@auth-ts/server"
import { sql } from "drizzle-orm"
import { authenticatedRole } from "drizzle-orm/neon"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  boolean,
  index,
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
  // Set on a guest row when its sign-in resolved to an existing account. It
  // cascades because that guest's rows are that account's data: deleting the
  // account has to take them too, or "delete my account" leaves a row nobody
  // can reach still holding it.
  primaryUserId: uuid("primaryUserId").references((): AnyPgColumn => users.id, {
    onDelete: "cascade"
  }),
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

export const verificationCodes = pgTable.withRLS(
  "verificationCodes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    identifier: text("identifier").notNull(),
    codeHash: text("codeHash").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    purpose: text("purpose")
      .$type<VerificationCodePurpose>()
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
  (table) => [
    // Indexed, not unique: a send deletes this identifier's codes and inserts a
    // new one, and two sends racing may leave both rows for an instant. The
    // newest by `expiresAt` is the live one.
    index("verificationCodesIdentifierIndex").on(table.identifier),
    index("verificationCodesExpiresAtIndex").on(table.expiresAt)
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
      .defaultNow()
  },
  (table) => [
    // A log, not a counter: one row per counted request, read back by key. Both
    // columns are indexed because both are read on every hot path — `key` to
    // count a window, `expiresAt` to sweep it.
    index("attemptsKeyIndex").on(table.key),
    index("attemptsExpiresAtIndex").on(table.expiresAt)
  ]
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
    // Unique, not merely indexed, and the contract says so: the library reads
    // this pair before it inserts, so two concurrent sign-ins with one provider
    // account both find nothing and both insert. This index is what refuses the loser
    // instead of letting one identity link twice.
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
    userId: uuid("userId")
      .notNull()
      .default(sql`(auth.user_id())::uuid`)
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
  () => [
    pgPolicy("own todos", {
      for: "all",
      to: authenticatedRole,
      using: sql`"userId" = (auth.user_id())::uuid`,
      withCheck: sql`"userId" = (auth.user_id())::uuid`
    })
  ]
)
