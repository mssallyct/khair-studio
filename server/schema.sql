-- Preparation only: not executed against any external database.
-- Use a dedicated server-side database connection. Never expose these tables
-- via a public data API or share database credentials with browser code.
begin;
create schema if not exists khair_private;
revoke all on schema khair_private from public;
create table if not exists khair_private.admin_accounts (
  id text primary key,
  username text not null unique constraint admin_accounts_username_format_check check (username ~ '^[a-z][a-z0-9_-]{2,31}$'),
  name text not null,
  password_hash text not null check (password_hash like 'scrypt$%'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists khair_private.sessions (
  token_hash text primary key check (length(token_hash)=64),
  account_id text not null references khair_private.admin_accounts(id),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists khair_session_expiry on khair_private.sessions(expires_at);
create table if not exists khair_private.login_attempts (
  key text not null,
  bucket bigint not null,
  attempts integer not null,
  primary key(key,bucket)
);
create table if not exists khair_private.business_state (
  singleton boolean primary key default true check (singleton),
  document jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists khair_private.migration_backups (
  id text primary key,
  document jsonb not null,
  checksum text not null,
  created_by text not null references khair_private.admin_accounts(id),
  created_at timestamptz not null default now()
);
revoke all on all tables in schema khair_private from public;
-- Do not initialize or import customer records until the existing browser data
-- has been backed up and the target database has been explicitly verified.
commit;
