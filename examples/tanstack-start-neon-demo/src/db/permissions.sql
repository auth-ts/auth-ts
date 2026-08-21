-- Applied after `drizzle-kit push`, because Drizzle has no API for grants or for
-- forcing row-level security. Both statements are idempotent, so running this on
-- every push is a no-op rather than something to remember.
--
-- The auth tables are protected in schema.ts instead: RLS enabled with no
-- policy, which denies every role except the owner.

-- PostgREST reads this table as `authenticated` and cannot see it at all without
-- the grant. The policy in schema.ts is what narrows it to the caller's own rows.
grant select, insert, update, delete on "todos" to authenticated;

-- RLS already binds `authenticated`, since policies apply to every role except
-- the table owner. `force` is the guard against a future query on the owner
-- connection quietly bypassing the policy — which is wanted here, and expressly
-- not wanted on the auth tables the server itself has to read.
alter table "todos" force row level security;
