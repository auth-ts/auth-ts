-- What the browser may touch through the Neon Data API.
--
-- Drizzle models tables, RLS policies, and roles; it has no concept of a GRANT.
-- So this half lives here, and `drizzle-kit push` neither creates it nor warns
-- when it is missing. Push can also drop it: privileges are attached to
-- columns, so recreating a column — a type change is enough — silently returns
-- it to the defaults. Re-run this file after every push.
--
-- Two roles reach the Data API: `authenticated` carries a token this library
-- signed, `anonymous` carries none. The Data API grants both broadly across
-- `public`, so every table is revoked first and granted back by column.
--
-- Row access is separate and lives in schema.ts as RLS policies. A grant says
-- which columns are legible; a policy says which rows. Neither works alone.

-- What the Data API hands out by default. Everything below narrows it.
grant usage on schema public to authenticated;
grant select, update, insert, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- No ALTER DEFAULT PRIVILEGES: this file is re-run after every push, so the
-- grant above already reaches a table added since. A standing rule would only
-- cover tables created without running this file — which is exactly the table
-- nobody has decided about yet.

-- Auth tables: the library's own, reachable only by the server's connection.
revoke all on table
  "users", "sessions", "verificationCodes", "attempts", "connections"
from authenticated, anonymous;

-- Nothing else is legible on a user row, and that is deliberate: RLS decides
-- which rows come back, so if a policy ever widens past "your own" — a public
-- profile, a member list — email and phoneNumber must not be carried along by
-- a grant nobody revisited.
grant select ("id", "name", "imageURL", "type", "createdAt")
  on table "users" to authenticated;
grant update ("name", "imageURL") on table "users" to authenticated;

-- Devices, for a session list. Never tokenHash: it is not reversible and not a
-- credential on its own, but no client has a use for it either.
grant select ("id", "userId", "userAgent", "ipAddress", "expiresAt", "createdAt")
  on table "sessions" to authenticated;

-- verificationCodes, attempts, and connections stay revoked. A live code and
-- the count of guesses against it are the two things a client must not read.

-- The application's own table.
revoke all on table "todos" from authenticated, anonymous;
grant select on table "todos" to authenticated;
grant insert ("title", "completed") on table "todos" to authenticated;
grant update ("title", "completed") on table "todos" to authenticated;
grant delete on table "todos" to authenticated;

-- userId is not insertable on purpose. It defaults to auth.user_id(), so the
-- database assigns the owner and a client cannot name someone else — the policy
-- would refuse it anyway, and this refuses it a step earlier.
