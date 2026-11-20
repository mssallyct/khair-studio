-- Preserve every existing account, password, session and business record.
-- Replace only the initial seven-name restriction with a username format rule.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='khair_private.admin_accounts'::regclass
      and conname='admin_accounts_username_format_check'
  ) then
    alter table khair_private.admin_accounts
      add constraint admin_accounts_username_format_check
      check (username ~ '^[a-z][a-z0-9_-]{2,31}$');
  end if;
  alter table khair_private.admin_accounts
    drop constraint if exists admin_accounts_username_check;
end $$;
