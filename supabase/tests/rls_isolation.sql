-- ===========================================================================
-- Row-level-security isolation tests
--
-- Proves that a signed-in user cannot reach another user's data, including by
-- guessing a primary key. Creates two throwaway users, asserts isolation from
-- each side, and cleans up after itself.
--
-- Run in the Supabase SQL editor. It raises an exception on the first failure,
-- which rolls the whole thing back; on success it prints a PASS line per check
-- and removes the fixtures.
--
-- Why this works: the SQL editor runs as a privileged role that bypasses RLS,
-- so each check switches to `authenticated` and sets request.jwt.claims to the
-- user under test — exactly what PostgREST does for a browser request.
-- ===========================================================================

do $$
declare
  user_a       uuid := '00000000-0000-4000-a000-00000000000a';
  user_b       uuid := '00000000-0000-4000-b000-00000000000b';
  acct_a       uuid;
  acct_b       uuid;
  task_a       uuid;
  visible      integer;
  affected     integer;
  passes       integer := 0;

  procedure_note text;
begin
  -- -------------------------------------------------------------------------
  -- Fixtures (created as the privileged role, so RLS does not apply yet)
  -- -------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls-test-a@example.invalid', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls-test-b@example.invalid', '', now(), now(), now())
  on conflict (id) do nothing;

  -- The signup trigger creates profiles; make sure both exist regardless.
  insert into profiles (id, display_name, niche)
  values (user_a, 'User A', 'A secret niche'), (user_b, 'User B', 'B secret niche')
  on conflict (id) do update set niche = excluded.niche;

  insert into social_accounts (user_id, platform, external_id, handle, scopes)
  values (user_a, 'x', 'ext-a', 'user_a_handle', array['users.read'])
  on conflict (user_id, platform, external_id) do update set handle = excluded.handle
  returning id into acct_a;

  insert into social_accounts (user_id, platform, external_id, handle, scopes)
  values (user_b, 'x', 'ext-b', 'user_b_handle', array['users.read'])
  on conflict (user_id, platform, external_id) do update set handle = excluded.handle
  returning id into acct_b;

  insert into social_account_tokens (account_id, access_token_enc)
  values (acct_a, 'v1.fake.envelope.for-user-a'), (acct_b, 'v1.fake.envelope.for-user-b')
  on conflict (account_id) do nothing;

  insert into social_account_metadata (account_id, user_id, platform, data)
  values (acct_a, user_a, 'x', '{"followers":1}'::jsonb),
         (acct_b, user_b, 'x', '{"followers":2}'::jsonb)
  on conflict (account_id) do nothing;

  insert into tasks (user_id, title, rationale)
  values (user_a, 'User A private task', 'because')
  returning id into task_a;

  insert into account_metrics (user_id, account_id, platform, captured_on, followers)
  values (user_a, acct_a, 'x', current_date, 111)
  on conflict (account_id, captured_on) do nothing;

  -- -------------------------------------------------------------------------
  -- Act as User B for every read/write check below.
  -- -------------------------------------------------------------------------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

  -- 1. Profiles
  select count(*) into visible from profiles where id = user_a;
  if visible <> 0 then raise exception 'FAIL: User B can read User A''s profile'; end if;
  raise notice 'PASS  User B cannot read User A''s profile';
  passes := passes + 1;

  select count(*) into visible from profiles;
  if visible <> 1 then raise exception 'FAIL: User B sees % profile rows, expected only their own', visible; end if;
  raise notice 'PASS  User B sees only their own profile row';
  passes := passes + 1;

  -- 2. Social connections, including by direct id (the "manipulated ID" case)
  select count(*) into visible from social_accounts where id = acct_a;
  if visible <> 0 then raise exception 'FAIL: User B can read User A''s connection by id'; end if;
  raise notice 'PASS  User B cannot read User A''s connection, even by exact id';
  passes := passes + 1;

  select count(*) into visible from social_accounts;
  if visible <> 1 then raise exception 'FAIL: User B sees % connections, expected 1', visible; end if;
  raise notice 'PASS  User B sees only their own connections';
  passes := passes + 1;

  -- 3. Tokens — no policies at all, so even the owner sees nothing here
  select count(*) into visible from social_account_tokens;
  if visible <> 0 then
    raise exception 'FAIL: authenticated role can read social_account_tokens (% rows)', visible;
  end if;
  raise notice 'PASS  Token table is unreadable by any authenticated client';
  passes := passes + 1;

  select count(*) into visible from social_account_tokens where account_id = acct_a;
  if visible <> 0 then raise exception 'FAIL: token readable by direct account_id'; end if;
  raise notice 'PASS  Tokens unreachable even with a known account_id';
  passes := passes + 1;

  -- 4. Account metadata
  select count(*) into visible from social_account_metadata where account_id = acct_a;
  if visible <> 0 then raise exception 'FAIL: User B can read User A''s account metadata'; end if;
  raise notice 'PASS  User B cannot read User A''s account metadata';
  passes := passes + 1;

  -- 5. Metrics and tasks
  select count(*) into visible from account_metrics where user_id = user_a;
  if visible <> 0 then raise exception 'FAIL: User B can read User A''s metrics'; end if;
  raise notice 'PASS  User B cannot read User A''s metrics';
  passes := passes + 1;

  select count(*) into visible from tasks where id = task_a;
  if visible <> 0 then raise exception 'FAIL: User B can read User A''s tasks'; end if;
  raise notice 'PASS  User B cannot read User A''s tasks';
  passes := passes + 1;

  -- 6. Writes: User B must not be able to modify or delete User A's rows
  update social_accounts set handle = 'hijacked' where id = acct_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: User B updated User A''s connection'; end if;
  raise notice 'PASS  User B cannot update User A''s connection';
  passes := passes + 1;

  delete from social_accounts where id = acct_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: User B deleted User A''s connection'; end if;
  raise notice 'PASS  User B cannot delete User A''s connection';
  passes := passes + 1;

  update profiles set niche = 'hijacked' where id = user_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: User B updated User A''s profile'; end if;
  raise notice 'PASS  User B cannot update User A''s profile';
  passes := passes + 1;

  -- 7. Ownership reassignment: User B must not move their own row to User A
  begin
    update social_accounts set user_id = user_a where id = acct_b;
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL: User B reassigned their connection to User A';
    end if;
    raise notice 'PASS  User B cannot reassign a connection to another user';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'PASS  User B cannot reassign a connection to another user (blocked by WITH CHECK)';
  end;
  passes := passes + 1;

  -- 8. Task insert must not be attributable to another user
  begin
    insert into tasks (user_id, title, rationale) values (user_a, 'injected', 'x');
    raise exception 'FAIL: User B inserted a task owned by User A';
  exception
    when insufficient_privilege then
      raise notice 'PASS  User B cannot insert a task owned by User A';
  end;
  passes := passes + 1;

  -- -------------------------------------------------------------------------
  -- Symmetry: the same must hold with the roles swapped.
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  select count(*) into visible from social_accounts where id = acct_b;
  if visible <> 0 then raise exception 'FAIL: User A can read User B''s connection'; end if;
  raise notice 'PASS  Symmetric: User A cannot read User B''s connection';
  passes := passes + 1;

  select count(*) into visible from profiles where id = user_b;
  if visible <> 0 then raise exception 'FAIL: User A can read User B''s profile'; end if;
  raise notice 'PASS  Symmetric: User A cannot read User B''s profile';
  passes := passes + 1;

  -- -------------------------------------------------------------------------
  -- Teardown, back as the privileged role.
  -- -------------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  delete from auth.users where id in (user_a, user_b);

  procedure_note := format('All %s RLS isolation checks passed. Fixtures removed.', passes);
  raise notice '%', procedure_note;
end
$$;
