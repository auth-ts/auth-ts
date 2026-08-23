-- Neon Data API
grant usage on schema public to authenticated;
grant select, update, insert, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke select on table "sessions" from authenticated;
grant select (
  "id", "userId", "userAgent", "ipAddress", "expiresAt", "createdAt", "updatedAt"
) on table "sessions" to authenticated;

revoke select on table "verificationCodes" from authenticated;
grant select (
  "id", "identifier", "action", "expiresAt", "createdAt", "updatedAt"
) on table "verificationCodes" to authenticated;
