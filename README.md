# Traction

AI-powered marketing strategy that tells you what to do next.

Traction connects your social accounts, tracks what's actually landing, watches what's trending, and uses Claude to turn all of that into a short list of concrete next actions. The dashboard shows what happened; the advisor tells you what to do about it.

Built on **Netlify** (static frontend + serverless functions), **Supabase** (Postgres, auth, row-level security), and the **Anthropic API** (Claude Opus 5).

---

## What's in here

| Area | What it does |
|---|---|
| **Dashboard** | Follower growth, reach and interaction, headline KPIs with period-over-period deltas, and the queue of next actions. |
| **Advisor** | Streaming chat that reads your real metrics, connected accounts, recent posts, and current trends before answering — and can write tasks straight into your queue. |
| **Trends** | Scans the live web for what's moving on each platform, scored and filtered against the niche in your settings. |
| **Accounts** | OAuth connections to X, LinkedIn, Reddit, and YouTube. Read-only scopes; Traction never posts for you. |
| **Daily briefing** | One-click read on where things stand plus three to five queued tasks. |

---

## Setup

You need a Supabase project and an Anthropic API key. Social connections are optional — the app works without them, and there's a demo seeder so you can see the dashboard populated on day one.

### 1. Install

```bash
npm install
```

### 2. Create the database

Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). In the SQL editor, run:

1. `supabase/migrations/0001_init.sql` — tables, row-level security, and the signup trigger.
2. `supabase/seed_demo.sql` — optional, adds the demo-data helpers.

### 3. Configure the environment

```bash
cp .env.example .env
```

Fill in at minimum:

| Variable | Where it comes from |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Same page. The service-role key is server-only — never expose it. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `TOKEN_ENCRYPTION_KEY` | Generate one (below). Required before connecting any social account. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Anything prefixed `VITE_` is compiled into the browser bundle and is public. Everything else is read only by the Netlify Functions.

### 4. Run it

```bash
npm run dev
```

This starts `netlify dev` on <http://localhost:8888>, which serves the Vite frontend and the functions together. **Use port 8888, not Vite's 5173** — the functions aren't reachable on 5173.

Sign up in the app, then optionally seed demo data from the Supabase SQL editor:

```sql
select seed_demo_data('you@example.com');
```

That gives you 90 days of metrics across three accounts, so the charts and the advisor have something real to work with.

---

## Connecting social accounts

Each platform needs its own OAuth app. All of them are optional and independent — a platform with no credentials configured simply shows as unavailable on the Accounts page.

For every provider, register this redirect URI:

```
https://YOUR-SITE.netlify.app/.netlify/functions/oauth-callback?platform=PLATFORM
```

Locally, substitute `http://localhost:8888`. `PLATFORM` is one of `x`, `linkedin`, `reddit`, `youtube`.

| Platform | Where to register | Env vars |
|---|---|---|
| X | [developer.x.com](https://developer.x.com) — OAuth 2.0 with PKCE | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| LinkedIn | [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Reddit | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) — type "web app" | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` |
| YouTube | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — enable the YouTube Data API v3 | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` |

**A note on LinkedIn:** member-level analytics (impressions, follower counts) require LinkedIn's Community Management API, which they grant only to approved partners. With the default scopes Traction can identify the account but reads zeros for metrics until your app is approved for the wider scopes.

---

## Deploying to Netlify

```bash
netlify init      # or connect the repo from the Netlify dashboard
```

Set every variable from `.env` in **Site configuration → Environment variables**, then set `APP_URL` to your deployed origin (no trailing slash) so OAuth redirect URIs are built correctly.

Build settings come from `netlify.toml` and need no changes:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

---

## How it's put together

```
src/                      React frontend (Vite + Tailwind)
  components/charts/      Chart primitives — validated palette, one axis, always-on tooltips
  hooks/                  Dashboard data loading and shaping
  pages/                  Dashboard, Advisor, Trends, Accounts, Settings
netlify/functions/        Serverless API
  _shared/                Auth, token encryption, provider registry, advisor context
  advisor.ts              Streaming Claude chat with a task-writing tool
  brief.ts                Daily briefing, structured output
  trends.ts               Trend discovery via Claude's server-side web search
  sync.ts                 Pulls metrics from every connected account
  oauth-start.ts          Begins an OAuth connect
  oauth-callback.ts       Completes it and stores encrypted tokens
shared/types.ts           Types used by both runtimes
supabase/migrations/      Schema and row-level security
```

### Security model

- **Row-level security on every user table.** The browser holds only the anon key; every query is filtered by `auth.uid()` in the database, not in application code.
- **OAuth tokens are unreachable from the browser.** They live in `social_account_tokens`, which has RLS enabled and *no policies at all* — PostgREST denies every request. Only functions holding the service-role key can read them.
- **Tokens are encrypted at rest** with AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, so a database dump alone doesn't yield usable credentials.
- **The OAuth handoff is CSRF-protected** by an HMAC-signed, httpOnly, 10-minute cookie that must match the `state` parameter on return.
- **Read-only scopes.** Traction never requests permission to post.

### Notes on the AI

The advisor runs on Claude Opus 5 with adaptive thinking, so it spends more reasoning on hard strategy questions and less on simple ones. Its context is assembled fresh on each turn from your profile, connected accounts, 30 days of metrics, recent posts, current trends, and open tasks — and that context block is prompt-cached, so follow-up questions in a conversation are cheap.

The `create_tasks` tool is what makes it an advisor rather than a chatbot: when it identifies concrete work, it writes it to your queue rather than leaving it in a chat log you'll never scroll back to.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Netlify dev server (frontend + functions) on :8888 |
| `npm run dev:vite` | Frontend only on :5173 — functions unavailable |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run typecheck` | Types only |
