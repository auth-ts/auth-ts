-- Timestamps the database owns, and columns a client may never write.
--
-- Drizzle models tables, RLS policies, and roles; triggers are not among them.
-- So this lives here, and `drizzle-kit push` neither creates it nor warns when
-- it is missing. Re-run this file after every push.

-- updatedAt on the database's clock, for every writer.
--
-- schema.ts sets it with $onUpdate, which runs in the application: the value is
-- whatever the machine handling the request believed the time was, and a row
-- written through the Data API never gets one at all. Both matter, because the
-- sweep of stale guests compares this column against now() inside the database.
-- Comparing one clock to another is a bug that only shows up as accounts
-- deleted early, or kept forever, on a host whose clock has drifted.
--
-- The trigger overwrites whatever was sent, so it wins over $onUpdate rather
-- than racing it.
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
create or replace trigger "attemptsUpdatedAt" before update on "attempts"
  for each row execute function set_updated_at();
create or replace trigger "todosUpdatedAt" before update on "todos"
  for each row execute function set_updated_at();
