-- ===========================================================================
-- Demo data seeder
--
-- Populates 90 days of plausible metrics for one user so the dashboard is
-- explorable before any real account is connected. Safe to re-run: it clears
-- the demo rows it created first.
--
-- Usage, from the Supabase SQL editor after signing up in the app:
--
--     select seed_demo_data('you@example.com');
--
-- To remove it again:
--
--     select clear_demo_data('you@example.com');
-- ===========================================================================

create or replace function seed_demo_data(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user   uuid;
  x_account     uuid;
  li_account    uuid;
  yt_account    uuid;
  day           date;
  offset_days   integer;
  -- Baselines, grown with a little noise so the charts have texture.
  x_followers   integer := 2400;
  li_followers  integer := 1150;
  yt_followers  integer := 480;
begin
  select id into target_user from auth.users where email = target_email;
  if target_user is null then
    return format('No user found with email %s. Sign up in the app first.', target_email);
  end if;

  perform clear_demo_data(target_email);

  insert into social_accounts (user_id, platform, external_id, handle, display_name, profile_url, last_sync_status, last_synced_at)
  values
    (target_user, 'x',        'demo-x-1',  'demo_operator', 'Demo Operator', 'https://x.com/demo_operator', 'success', now()),
    (target_user, 'linkedin', 'demo-li-1', 'demo-operator', 'Demo Operator', 'https://linkedin.com/in/demo-operator', 'success', now()),
    (target_user, 'youtube',  'demo-yt-1', 'demooperator',  'Demo Operator', 'https://youtube.com/@demooperator', 'success', now())
  returning id into x_account;

  select id into x_account  from social_accounts where user_id = target_user and external_id = 'demo-x-1';
  select id into li_account from social_accounts where user_id = target_user and external_id = 'demo-li-1';
  select id into yt_account from social_accounts where user_id = target_user and external_id = 'demo-yt-1';

  for offset_days in reverse 89..0 loop
    day := current_date - offset_days;

    -- Compounding growth plus day-to-day noise.
    x_followers  := x_followers  + 8  + floor(random() * 14)::int;
    li_followers := li_followers + 4  + floor(random() * 9)::int;
    yt_followers := yt_followers + 1  + floor(random() * 5)::int;

    insert into account_metrics
      (user_id, account_id, platform, captured_on, followers, following, posts_count, impressions, engagements, profile_views, link_clicks)
    values
      (target_user, x_account, 'x', day, x_followers, 890, 340 + (89 - offset_days),
       3200 + floor(random() * 5200)::int, 180 + floor(random() * 380)::int,
       90 + floor(random() * 160)::int, 12 + floor(random() * 40)::int),

      (target_user, li_account, 'linkedin', day, li_followers, 620, 95 + ((89 - offset_days) / 3),
       1400 + floor(random() * 2600)::int, 95 + floor(random() * 210)::int,
       60 + floor(random() * 110)::int, 8 + floor(random() * 26)::int),

      (target_user, yt_account, 'youtube', day, yt_followers, 0, 22 + ((89 - offset_days) / 10),
       800 + floor(random() * 1900)::int, 40 + floor(random() * 130)::int,
       30 + floor(random() * 70)::int, 3 + floor(random() * 14)::int);
  end loop;

  -- A handful of posts so the advisor has content to reason about.
  insert into posts (user_id, account_id, platform, external_id, content, url, published_at, impressions, likes, comments, shares)
  values
    (target_user, x_account, 'x', 'demo-post-1',
     'Spent three weeks rebuilding onboarding. Activation went from 31% to 48%. The whole win came from deleting steps, not adding them.',
     'https://x.com/demo_operator/status/1', now() - interval '3 days', 18400, 620, 84, 133),
    (target_user, x_account, 'x', 'demo-post-2',
     'Unpopular opinion: most "growth" problems are retention problems wearing a hat.',
     'https://x.com/demo_operator/status/2', now() - interval '9 days', 9100, 310, 52, 61),
    (target_user, li_account, 'linkedin', 'demo-post-3',
     'A breakdown of how we cut support tickets 40% by rewriting three error messages.',
     'https://linkedin.com/posts/demo-3', now() - interval '5 days', 6200, 210, 38, 24),
    (target_user, yt_account, 'youtube', 'demo-post-4',
     'Building a SaaS dashboard from scratch — full walkthrough',
     'https://youtube.com/watch?v=demo4', now() - interval '12 days', 4300, 180, 44, 19);

  update profiles
  set niche    = coalesce(niche, 'Indie SaaS tools for small product teams'),
      audience = coalesce(audience, 'Solo founders and 2-5 person product teams shipping B2B software'),
      goals    = coalesce(goals, 'Reach 5,000 X followers and 1,000 email subscribers in the next two quarters')
  where id = target_user;

  return format('Seeded 90 days of demo data across 3 accounts for %s.', target_email);
end;
$$;

create or replace function clear_demo_data(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
begin
  select id into target_user from auth.users where email = target_email;
  if target_user is null then
    return format('No user found with email %s.', target_email);
  end if;

  -- Metrics, posts, and tokens cascade from social_accounts.
  delete from social_accounts
  where user_id = target_user and external_id like 'demo-%';

  return format('Cleared demo data for %s.', target_email);
end;
$$;
