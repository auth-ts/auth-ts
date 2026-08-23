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

revoke select on table "sessions" from authenticated;
grant select (
  "id", "userId", "userAgent", "ipAddress", "expiresAt", "createdAt", "updatedAt"
) on table "sessions" to authenticated;

revoke update on table "users" from authenticated;
grant update ("name", "imageURL", "updatedAt") on table "users" to authenticated;
