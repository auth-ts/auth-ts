-- Not modelled by Drizzle, and dropped by a push that recreates a table.
-- $onUpdate runs in the application and never fires for a Data API write; the
-- guest sweep compares this column against now() inside the database.
create or replace function set_updated_at() returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger "usersUpdatedAt" before update on "users"
  for each row execute function set_updated_at();
create or replace trigger "sessionsUpdatedAt" before update on "sessions"
  for each row execute function set_updated_at();
create or replace trigger "verificationCodesUpdatedAt" before update on "verificationCodes"
  for each row execute function set_updated_at();
create or replace trigger "connectionsUpdatedAt" before update on "connections"
  for each row execute function set_updated_at();
