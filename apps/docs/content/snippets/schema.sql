create table "users" (
  "id" uuid primary key default gen_random_uuid(),
  "email" text unique,
  "phoneNumber" text unique,
  "name" text,
  "image" text,
  "type" text not null default 'user' check ("type" in ('guest', 'user', 'admin')),
  "primaryUserId" uuid references "users" on delete cascade,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "sessions" (
  "id" uuid primary key default gen_random_uuid(),
  "userId" uuid not null references "users" on delete cascade,
  "secretHash" text not null,
  "userAgent" text,
  "ipAddress" text,
  "amr" text[],
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index on "sessions" ("userId");
create index on "sessions" ("updatedAt");

create table "verifications" (
  "id" uuid primary key default gen_random_uuid(),
  "identifier" text not null,
  "codeHash" text not null,
  "attemptHash" text not null,
  "purpose" text not null check ("purpose" in ('signIn', 'identity', 'emailChange', 'phoneChange')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index on "verifications" ("identifier", "purpose", "attemptHash");
create index on "verifications" ("attemptHash");
create index on "verifications" ("updatedAt");

create table "rateLimits" (
  "id" uuid primary key default gen_random_uuid(),
  "key" text not null unique,
  "tokenCount" integer not null,
  "lastRefilledAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index on "rateLimits" ("updatedAt");

create table "identities" (
  "id" uuid primary key default gen_random_uuid(),
  "userId" uuid not null references "users" on delete cascade,
  "provider" text not null,
  "providerUserId" text not null,
  "label" text,
  "scope" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("provider", "providerUserId")
);
create index on "identities" ("userId");

create table "identitySecrets" (
  "id" uuid primary key default gen_random_uuid(),
  "identityId" uuid not null unique references "identities" on delete cascade,
  "accessToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshToken" text,
  "refreshTokenExpiresAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table "users" enable row level security;
alter table "sessions" enable row level security;
alter table "verifications" enable row level security;
alter table "rateLimits" enable row level security;
alter table "identities" enable row level security;
alter table "identitySecrets" enable row level security;
