create or replace function set_updated_at() returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger "usersUpdatedAt" before update on "users"
  for each row execute function set_updated_at();