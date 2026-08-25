-- BEGIN Neon Data API

-- Schema usage
GRANT USAGE ON SCHEMA public TO authenticated;
-- For existing tables
GRANT SELECT, UPDATE, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- For future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, UPDATE, INSERT, DELETE ON TABLES TO authenticated;
-- For sequences (for identity columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- END Neon Data API

-- The only revoke here, and the only one that matters. Neon's default grants
-- UPDATE on every column, so without this a signed-in user can set their own
-- "type" to 'admin' or repoint "email" at somebody else's account.
--
-- Nothing else needs one. "sessions"."tokenHash" is a SHA-256 of 32 random
-- bytes and cannot be replayed; the provider tokens live in "identitySecrets",
-- which has no policy and so is denied to every role but the owner.
revoke update on table "users" from authenticated;
grant update ("name", "image", "updatedAt") on table "users" to authenticated;
