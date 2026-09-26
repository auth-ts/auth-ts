import type { UserType, VerificationPurpose } from "@auth-ts/core"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid
} from "drizzle-orm/pg-core"

const timestamps = {
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow()
}

export const users = pgTable.withRLS("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  phoneNumber: text("phoneNumber").unique(),
  name: text("name"),
  image: text("image"),
  type: text("type").$type<UserType>().notNull().default("user"),
  primaryUserId: uuid("primaryUserId").references((): AnyPgColumn => users.id, {
    onDelete: "cascade"
  }),
  ...timestamps
})

export const sessions = pgTable.withRLS(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secretHash: text("secretHash").notNull(),
    userAgent: text("userAgent"),
    ipAddress: text("ipAddress"),
    amr: text("amr").array(),
    ...timestamps
  },
  (table) => [index().on(table.userId), index().on(table.updatedAt)]
)

export const verifications = pgTable.withRLS(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    codeHash: text("codeHash").notNull(),
    attemptHash: text("attemptHash").notNull(),
    purpose: text("purpose").$type<VerificationPurpose>().notNull(),
    ...timestamps
  },
  (table) => [
    index().on(table.identifier, table.purpose, table.attemptHash),
    index().on(table.attemptHash),
    index().on(table.updatedAt)
  ]
)

export const rateLimits = pgTable.withRLS(
  "rateLimits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    tokenCount: integer("tokenCount").notNull(),
    lastRefilledAt: timestamp("lastRefilledAt", {
      withTimezone: true
    }).notNull(),
    ...timestamps
  },
  (table) => [index().on(table.updatedAt)]
)

export const identities = pgTable.withRLS(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("providerUserId").notNull(),
    label: text("label"),
    scope: text("scope"),
    ...timestamps
  },
  (table) => [
    unique().on(table.provider, table.providerUserId),
    index().on(table.userId)
  ]
)

export const identitySecrets = pgTable.withRLS("identitySecrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identityId")
    .notNull()
    .unique()
    .references(() => identities.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
    withTimezone: true
  }),
  refreshToken: text("refreshToken"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
    withTimezone: true
  }),
  ...timestamps
})
