-- ===========================================================================
-- Connection lifecycle states, browser-safe account metadata, and hardened
-- RLS policies.
--
-- Additive only. Nothing existing is dropped or renamed, so the currently
-- deployed app keeps working against this schema.
--
-- Run AFTER 0002_add_pinterest.sql has committed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Connection status
--
-- `is_active` (boolean) could only say "usable / not usable". The UI needs to
-- distinguish a healthy connection from one whose token was revoked at the
-- provider from one that is merely erroring, because the remedy differs:
-- nothing, reconnect, retry. `is_active` is retained and kept in sync so any
-- code still reading it behaves as before.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'connection_status') then
    create type connection_status as enum (
      'connected',
      'needs_reauthorization',
      'error',
      'disconnected'
    );
  end if;
end
$$;

alter table social_accounts
  add column if not exists status connection_status not null default 'connected',
  -- User-facing explanation. Never contains tokens, secrets, or raw API bodies.
  add column if not exists status_detail text,
  add column if not exists needs_reauth_since timestamptz,
  add column if not exists last_authorized_at timestamptz;

-- Backfill from the pre-existing boolean.
update social_accounts
set status = case when is_active then 'connected'::connection_status else 'needs_reauthorization'::connection_status end
where status = 'connected' and is_active = false;

update social_accounts
set last_authorized_at = connected_at
where last_authorized_at is null;

create index if not exists social_accounts_status_idx on social_accounts (user_id, status);

-- Keep `is_active` consistent with `status` so both readings agree.
create or replace function sync_connection_is_active()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.status = 'connected' or new.status = 'error');
  return new;
end;
$$;

drop trigger if exists social_accounts_sync_is_active on social_accounts;
create trigger social_accounts_sync_is_active
  before insert or update of status on social_accounts
  for each row execute function sync_connection_is_active();

-- ---------------------------------------------------------------------------
-- social_account_metadata
--
-- Non-sensitive, browser-readable platform detail: follower counts, account
-- type, board counts, verification flags — whatever a given platform returns
-- that is safe to show. Deliberately separate from social_account_tokens so
-- that the readable half and the secret half can never be confused, and one
-- row per account so a platform can evolve its payload without a migration.
-- ---------------------------------------------------------------------------

create table if not exists social_account_metadata (
  account_id   uuid primary key references social_accounts on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  platform     platform not null,
  -- Safe to expose to the browser. Never put a token or secret in here.
  data         jsonb not null default '{}'::jsonb,
  captured_at  timestamptz not null default now()
);

alter table social_account_metadata enable row level security;

drop policy if exists "own account metadata: read" on social_account_metadata;
create policy "own account metadata: read"
  on social_account_metadata for select
  using (auth.uid() = user_id);

create index if not exists social_account_metadata_user_idx
  on social_account_metadata (user_id, platform);

-- ---------------------------------------------------------------------------
-- Harden existing policies
--
-- For UPDATE, Postgres falls back to the USING expression when WITH CHECK is
-- omitted, so the original policies were already safe. Stating WITH CHECK
-- explicitly removes the need to know that rule to audit them, and closes off
-- any possibility of a row being updated to point at another user_id.
-- ---------------------------------------------------------------------------

drop policy if exists "own profile: update" on profiles;
create policy "own profile: update"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "own accounts: update" on social_accounts;
create policy "own accounts: update"
  on social_accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own tasks: update" on tasks;
create policy "own tasks: update"
  on tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own threads: update" on advisor_threads;
create policy "own threads: update"
  on advisor_threads for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- `social_account_tokens` intentionally still has RLS enabled with zero
-- policies: PostgREST denies every request from anon and authenticated roles.
-- Only the service role, used by trusted server-side functions, can reach it.
-- This block is a guard so a future migration cannot silently loosen that.
do $$
begin
  if exists (select 1 from pg_policies where tablename = 'social_account_tokens') then
    raise exception 'social_account_tokens must have no RLS policies; tokens would become client-readable.';
  end if;
  if not exists (
    select 1 from pg_class where relname = 'social_account_tokens' and relrowsecurity
  ) then
    raise exception 'social_account_tokens must have row level security enabled.';
  end if;
end
$$;
