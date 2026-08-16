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
| **Accounts** | OAuth 2.0 connections to X, LinkedIn, Reddit, YouTube, Instagram, and TikTok. Read-only scopes; Traction never sees your password and never posts for you. |
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

**Traction never asks for a social-media password or API key.** Every connection is a standard OAuth 2.0 authorization-code grant: you click Connect, the platform's own sign-in page opens on *their* domain, you approve the requested permissions there, and the platform hands Traction a token. Your credentials never touch this application.

All scopes requested are read-only. Traction cannot post, comment, message, vote, or follow on your behalf, because it never asks for the permissions that would allow it.

### Registering the OAuth apps

Each platform needs its own OAuth app, registered once by whoever operates the deployment. All are optional and independent — a platform with no credentials configured shows as unavailable on the Accounts page and everything else keeps working.

Register this redirect URI with every provider, substituting your origin and the platform slug:

```
https://YOUR-SITE.netlify.app/.netlify/functions/oauth-callback?platform=SLUG
```

Locally, use `http://localhost:8888`.

| Platform | Slug | Where to register | Env vars | PKCE |
|---|---|---|---|:--:|
| X | `x` | [developer.x.com](https://developer.x.com) | `X_CLIENT_ID`, `X_CLIENT_SECRET` | ✅ |
| LinkedIn | `linkedin` | [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | — |
| Reddit | `reddit` | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) — type "web app" | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | — |
| YouTube | `youtube` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — enable YouTube Data API v3 | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | ✅ |
| Instagram | `instagram` | [developers.facebook.com/apps](https://developers.facebook.com/apps) — add the Instagram product, use Instagram Login | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | — |
| TikTok | `tiktok` | [developers.tiktok.com/apps](https://developers.tiktok.com/apps) — Login Kit v2 | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | ✅ |

PKCE is used wherever the provider supports it. Reddit, LinkedIn, and Instagram do not document support for it; those flows are still protected by the signed-state check described below.

### What each connection asks for

| Platform | Scopes | What that allows |
|---|---|---|
| X | `tweet.read users.read offline.access` | Read profile and public post metrics |
| LinkedIn | `openid profile email` | Read name, headline, photo |
| Reddit | `identity history read` | Read username, karma, post history |
| YouTube | `youtube.readonly` | Read channel details and statistics |
| Instagram | `instagram_business_basic`, `instagram_business_manage_insights` | Read profile, media list, insights |
| TikTok | `user.info.basic`, `user.info.profile`, `user.info.stats` | Read profile and follower statistics |

### Platform-specific notes

- **LinkedIn** — member-level analytics need the Community Management API, granted only to approved partners. Traction identifies the account with the default scopes and simply skips the follower-statistics source until your app holds `r_organization_social`.
- **Instagram** — requires a Business or Creator account; personal accounts cannot grant these scopes. Instagram issues no refresh token: the 60-day long-lived token refreshes itself, and expires permanently after 60 days without a sync. Traction exchanges the short-lived code for a long-lived token before storing anything.
- **TikTok** — calls the client id a "client key", which is why the env var is `TIKTOK_CLIENT_KEY`. Follower counts sit behind `user.info.stats` separately from basic profile access.
- **Reddit** — `duration=permanent` is what makes Reddit issue a refresh token at all; without it the grant expires in an hour.

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

**Credentials**

- **No passwords, ever.** Authentication happens on the platform's own domain. Traction has no field that accepts a social password and no code path that would transmit one.
- **No user-supplied API keys.** The only platform credentials in the system are *your deployment's* OAuth client id and secret, held server-side. Users supply nothing.
- **Read-only scopes.** Traction cannot post on your behalf because it never requests the permission to.

**Token handling**

- **Tokens are unreachable from the browser.** They live in `social_account_tokens`, which has RLS enabled and *no policies at all* — PostgREST denies every request from the anon key. Only functions holding the service-role key can read them.
- **Encrypted at rest** with AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, in a versioned envelope so the scheme can be rotated. A database dump alone yields nothing usable.
- **Refreshed server-side** a minute before expiry, with rotated refresh tokens persisted when the provider issues them.
- **Revoked on disconnect.** Disconnecting calls the provider's revocation endpoint *before* deleting the local row, so the grant dies at the source rather than lingering. If revocation fails the UI says so and points you at your platform settings.

**Flow integrity**

- **PKCE** on every provider that supports it — the authorization code is bound to a one-time verifier that never leaves the server.
- **Signed state.** The OAuth handoff carries an HMAC-signed, httpOnly, `SameSite=Lax`, 10-minute cookie that must match the returned `state` parameter exactly. A mismatch aborts the connection.
- **Client secrets never reach the browser.** They are used only in server-to-server token calls, over HTTP Basic or a POST body — never a query parameter on a redirect.

**Least privilege at call time**

Storing scopes is not the same as honouring them. Each metric source declares the scopes it requires, and `collectMetrics` runs only those the user actually granted — an unauthorized source is skipped, never attempted. If you decline a permission on the consent screen, the connection still succeeds, the dashboard tells you which capability is missing, and Traction never issues a request you didn't authorize.

Run `npm run check:oauth` to verify this offline: it checks PKCE derivation, state tampering and expiry, per-provider authorize-URL construction, scope gating, and the encryption envelope, with no network or credentials required.

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
| `npm run check:oauth` | Offline verification of the OAuth plumbing — PKCE, signed state, authorize URLs, scope gating, token encryption |
