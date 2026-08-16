-- ===========================================================================
-- Traction — initial schema
--
-- Security model:
--   * Every user-owned table has RLS enabled with policies keyed on auth.uid().
--   * OAuth tokens live in their own table with RLS enabled and NO policies,
--     so PostgREST denies all access to browser clients. Only Netlify
--     Functions holding the service-role key can read them.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type platform as enum ('x', 'linkedin', 'reddit', 'youtube', 'instagram', 'tiktok');
create type sync_status as enum ('pending', 'running', 'success', 'error');
create type task_status as enum ('suggested', 'accepted', 'done', 'dismissed');
create type task_effort as enum ('quick', 'medium', 'deep');

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created automatically on signup
-- ---------------------------------------------------------------------------

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,
  -- Free-text positioning that the advisor reads as standing context.
  niche         text,
  audience      text,
  goals         text,
  timezone      text not null default 'UTC',
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "own profile: read"   on profiles for select using (auth.uid() = id);
create policy "own profile: insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile: update" on profiles for update using (auth.uid() = id);

-- Provision a profile row whenever a new auth user appears.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- social_accounts — a connected account. Safe for the browser to read.
-- ---------------------------------------------------------------------------

create table social_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  platform         platform not null,
  -- The platform's own id for the account, used to dedupe reconnects.
  external_id      text not null,
  handle           text not null,
  display_name     text,
  avatar_url       text,
  profile_url      text,
  scopes           text[] not null default '{}',
  connected_at     timestamptz not null default now(),
  last_synced_at   timestamptz,
  last_sync_status sync_status not null default 'pending',
  last_sync_error  text,
  -- Set false on revoke/expiry so the UI can prompt a reconnect.
  is_active        boolean not null default true,

  unique (user_id, platform, external_id)
);

alter table social_accounts enable row level security;

create policy "own accounts: read"   on social_accounts for select using (auth.uid() = user_id);
create policy "own accounts: update" on social_accounts for update using (auth.uid() = user_id);
create policy "own accounts: delete" on social_accounts for delete using (auth.uid() = user_id);

create index social_accounts_user_idx on social_accounts (user_id, platform);

-- ---------------------------------------------------------------------------
-- social_account_tokens — RLS on, zero policies. Service role only.
-- ---------------------------------------------------------------------------

create table social_account_tokens (
  account_id             uuid primary key references social_accounts on delete cascade,
  -- AES-256-GCM ciphertext, base64. See netlify/functions/_shared/crypto.ts.
  access_token_enc       text not null,
  refresh_token_enc      text,
  expires_at             timestamptz,
  updated_at             timestamptz not null default now()
);

alter table social_account_tokens enable row level security;
-- Intentionally no policies: browser clients are denied outright.

-- ---------------------------------------------------------------------------
-- account_metrics — one row per account per day
-- ---------------------------------------------------------------------------

create table account_metrics (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  account_id     uuid not null references social_accounts on delete cascade,
  platform       platform not null,
  captured_on    date not null,

  followers      integer not null default 0,
  following      integer not null default 0,
  posts_count    integer not null default 0,
  impressions    integer not null default 0,
  engagements    integer not null default 0,
  profile_views  integer not null default 0,
  link_clicks    integer not null default 0,

  created_at     timestamptz not null default now(),

  unique (account_id, captured_on)
);

alter table account_metrics enable row level security;

create policy "own metrics: read" on account_metrics for select using (auth.uid() = user_id);

create index account_metrics_lookup_idx on account_metrics (user_id, captured_on desc);

-- ---------------------------------------------------------------------------
-- posts — published content and its performance
-- ---------------------------------------------------------------------------

create table posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  account_id    uuid not null references social_accounts on delete cascade,
  platform      platform not null,
  external_id   text not null,

  content       text,
  url           text,
  published_at  timestamptz not null,

  impressions   integer not null default 0,
  likes         integer not null default 0,
  comments      integer not null default 0,
  shares        integer not null default 0,
  saves         integer not null default 0,
  clicks        integer not null default 0,

  synced_at     timestamptz not null default now(),

  unique (account_id, external_id)
);

alter table posts enable row level security;

create policy "own posts: read" on posts for select using (auth.uid() = user_id);

create index posts_recent_idx on posts (user_id, published_at desc);

-- ---------------------------------------------------------------------------
-- trending_topics — platform-wide, captured by a scheduled job.
-- Readable by any signed-in user; only the service role writes.
-- ---------------------------------------------------------------------------

create table trending_topics (
  id            uuid primary key default gen_random_uuid(),
  platform      platform not null,
  topic         text not null,
  -- Normalised 0–100 so topics compare across platforms.
  score         numeric(5,2) not null default 0,
  -- Percent change vs the previous capture; null on first sighting.
  momentum      numeric(6,2),
  volume        integer,
  region        text not null default 'global',
  url           text,
  captured_at   timestamptz not null default now(),

  unique (platform, topic, region, captured_at)
);

alter table trending_topics enable row level security;

create policy "trends: read for signed-in users"
  on trending_topics for select
  using (auth.role() = 'authenticated');

create index trending_topics_recent_idx on trending_topics (captured_at desc, score desc);

-- ---------------------------------------------------------------------------
-- tasks — the "what do I do next" queue the advisor writes into
-- ---------------------------------------------------------------------------

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,

  title        text not null,
  detail       text,
  -- Why the advisor thinks this matters now, shown under the title.
  rationale    text,
  platform     platform,
  effort       task_effort not null default 'quick',
  -- 1 (highest) … 5. Drives ordering on the dashboard.
  priority     smallint not null default 3 check (priority between 1 and 5),
  status       task_status not null default 'suggested',
  due_on       date,

  source       text not null default 'advisor',
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

alter table tasks enable row level security;

create policy "own tasks: read"   on tasks for select using (auth.uid() = user_id);
create policy "own tasks: insert" on tasks for insert with check (auth.uid() = user_id);
create policy "own tasks: update" on tasks for update using (auth.uid() = user_id);
create policy "own tasks: delete" on tasks for delete using (auth.uid() = user_id);

create index tasks_open_idx on tasks (user_id, status, priority);

-- ---------------------------------------------------------------------------
-- advisor_threads / advisor_messages — conversation history
-- ---------------------------------------------------------------------------

create table advisor_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table advisor_threads enable row level security;

create policy "own threads: read"   on advisor_threads for select using (auth.uid() = user_id);
create policy "own threads: insert" on advisor_threads for insert with check (auth.uid() = user_id);
create policy "own threads: update" on advisor_threads for update using (auth.uid() = user_id);
create policy "own threads: delete" on advisor_threads for delete using (auth.uid() = user_id);

create table advisor_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references advisor_threads on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

alter table advisor_messages enable row level security;

create policy "own messages: read"   on advisor_messages for select using (auth.uid() = user_id);
create policy "own messages: insert" on advisor_messages for insert with check (auth.uid() = user_id);

create index advisor_messages_thread_idx on advisor_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- sync_runs — audit trail so failures are visible rather than silent
-- ---------------------------------------------------------------------------

create table sync_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  account_id   uuid references social_accounts on delete set null,
  status       sync_status not null default 'running',
  message      text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

alter table sync_runs enable row level security;

create policy "own sync runs: read" on sync_runs for select using (auth.uid() = user_id);

create index sync_runs_recent_idx on sync_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Convenience view: latest metric row per account
-- ---------------------------------------------------------------------------

create view latest_account_metrics
with (security_invoker = true)
as
select distinct on (account_id)
  account_id, user_id, platform, captured_on,
  followers, impressions, engagements, profile_views, link_clicks
from account_metrics
order by account_id, captured_on desc;
