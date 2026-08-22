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

/**
 * The demo's schema.
 *
 * Identifiers are camelCase and therefore quoted everywhere, which Postgres
 * requires once you use them: unquoted identifiers fold to lowercase, and mixing
 * the two conventions produces the memorable error where a column that is plainly
 * visible "does not exist".
 *
 * `uuidv7()` is native in Postgres 18. On 17, install the `pg_uuidv7` extension
 * (Neon supports it) or swap these defaults for `gen_random_uuid()`.
 */
const primaryKey = () => uuid("id").primaryKey().default(sql`uuidv7()`)

const createdAt = () =>
  timestamp("createdAt", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

/**
 * Users.
 *
 * Both identifiers are nullable because a guest has neither, and unique when
 * present so one person cannot become two accounts.
 *
 * Row-level security is enabled here — and on every other auth table — with no
 * policy attached. That combination denies every role except the table owner,
 * which is exactly right: the server connects as the owner and the callbacks
 * work, while the Data API connects as `authenticated` and sees nothing at all.
 *
 * This is not belt and braces. Neon grants `authenticated` full CRUD on
 * everything in `public` when the Data API is turned on, so without it any
 * signed-in user could read every account, every session token hash, and every
 * live magic code by querying the REST endpoint directly. Note the contrast with
 * `todos`, which enables RLS *and* forces it, because there the owner should be
 * constrained too.
 */
export const users = pgTable.withRLS("users", {
  id: primaryKey(),
  email: text("email").unique(),
  phoneNumber: text("phoneNumber").unique(),
  name: text("name"),
  imageURL: text("imageURL"),
  type: text("type").$type<UserType>().notNull().default("user"),
  primaryUserId: uuid("primaryUserId"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
})

/** Refresh tokens, stored only as hashes. */
export const sessions = pgTable.withRLS(
  "sessions",
  {
    id: primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull().unique(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    userAgent: text("userAgent"),
    ipAddress: text("ipAddress"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("sessionsUserIdIndex").on(table.userId),
    index("sessionsExpiresAtIndex").on(table.expiresAt)
  ]
)

/** Live magic codes — one per identifier, enforced by the unique constraint. */
export const magicCodes = pgTable.withRLS(
  "magicCodes",
  {
    id: primaryKey(),
    identifier: text("identifier").notNull().unique(),
    codeHash: text("codeHash").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    purpose: text("purpose")
      .$type<MagicCodePurpose>()
      .notNull()
      .default("signIn"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index("magicCodesExpiresAtIndex").on(table.expiresAt)]
)

/** Fixed-window rate-limit counters. */
export const rateLimits = pgTable.withRLS(
  "rateLimits",
  {
    id: primaryKey(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("resetAt", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [index("rateLimitsResetAtIndex").on(table.resetAt)]
)

/** Linked provider identities, keyed on the provider's stable account id. */
export const connections = pgTable.withRLS(
  "connections",
  {
    id: primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    email: text("email"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
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

/**
 * The application's own table — the one the browser reads directly.
 *
 * `userId` defaults to `auth.user_id()` from the verified JWT, so the value is
 * server-derived and a client-supplied one is simply overwritten. The policy then
 * restricts every row to its owner, which is the property the whole demo exists
 * to prove.
 */
export const todos = pgTable.withRLS(
  "todos",
  {
    id: primaryKey(),
    userId: uuid("userId").notNull().default(sql`(auth.user_id()::uuid)`),
    title: text("title").notNull(),
    completed: boolean("completed").notNull().default(false),
    createdAt: createdAt()
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
