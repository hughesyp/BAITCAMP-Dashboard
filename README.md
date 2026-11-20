# BAITCAMP Dashboard

An internal web app for the people hired to market BAITCAMP on social media. They log in, see how the product and its social accounts are performing, create and publish posts through the owner's accounts without ever holding a third-party login, and see the revenue share they have earned.

This README is the handover document for a developer picking the project up. For installing, API keys and deployment, see [SETUP.md](SETUP.md).

## What it does

| Screen | Route | Purpose |
| --- | --- | --- |
| Overview | `/` | Net revenue, sales, followers, reach and posts over 7/30/90 days; revenue per day; top sales sources; this month's targets |
| Revenue & sources | `/revenue` | Gumroad sales by referrer source and by product, plus recent sales |
| Post performance | `/posts` | Every post sent through the dashboard, per platform, with status, link and stats; filter by person or platform |
| Create post | `/compose` | Upload media, choose platforms, write a caption and first comment per platform, publish now or schedule. Includes the AI caption writer |
| Calendar | `/calendar` | Month view of draft, scheduled and published posts |
| Media library | `/media` | Shared images and videos, with tags and a "brand asset" flag |
| Targets | `/targets` | Monthly targets (revenue, sales, posts, followers, reach, engagement) with live progress |
| Ideas & tasks | `/ideas` | Simple three-column board; an idea can be turned into a post |
| Brand voice | `/brand` | Product summary, voice, guidelines, do/don't, hashtags, links. Read by marketers and fed to the AI writer |
| Revenue share | `/earnings` | Monthly statement of a marketer's share; the admin records payouts here |
| Team (admin) | `/team` | Invite people by email; set start date, revenue share %, role, active/deactivated |
| Settings (admin) | `/settings` | Which API keys are set, Blotato account mapping, Meta IDs, manual syncs, sync log |

Supported platforms: Facebook, Instagram, Threads, X and TikTok. The list lives in one place, `PLATFORMS` in `src/lib/util.ts`.

## Roles and business rules

- **Admin** (the owner): everything, including Team, Settings, editing brand voice and targets, and recording payouts. The first account ever created becomes the admin.
- **Marketer**: sees all stats and everyone's posts, creates and publishes their own posts, and sees only their own revenue share. Cannot see other people's share terms.
- There is no public sign-up. People join by admin invite. An account created any other way is inactive and can read nothing.
- Marketers publish and schedule directly; there is no approval step.
- **Revenue share** = the marketer's percentage of net Gumroad revenue from their start date onward. Net is sale price minus Gumroad fee; refunded and charged-back sales count as zero. All products on the Gumroad account count. It is calculated per calendar month by the database function `revenue_share_statement`, and the admin marks each month as paid (payment itself happens outside the app).

## Architecture

```
Browser (React SPA on Azure Static Web Apps)
   │  Supabase JS client, using the public anon key + the user's login
   ▼
Supabase
   ├─ Auth            email + password, invite and reset emails
   ├─ Postgres        all data, protected by row-level security (RLS)
   ├─ Storage         public "media" bucket for uploaded images/videos
   └─ Edge Functions  the only place third-party API keys exist
          ├─ Gumroad API      sales
          ├─ Meta Graph API   Facebook + Instagram account stats
          ├─ Blotato API      publishing, post status, per-post stats
          └─ OpenRouter API   AI caption writing
```

Two rules follow from this and should be kept:

1. **No secret ever reaches the browser.** The front end holds only the Supabase URL and anon key. Anything needing an API key goes in an Edge Function.
2. **Security is enforced in the database, not the UI.** Hiding a button is cosmetic; the RLS policies and the checks inside each Edge Function are what stop a marketer doing admin things. Any new table needs RLS policies and explicit grants (see "Gotchas").

## Tech stack

- Vite, React 19, TypeScript, React Router, TanStack Query for data fetching
- Tailwind CSS v4 (small set of shared classes in `src/index.css`: `card`, `btn`, `input`, `label`, `th`, `td`)
- Recharts for charts, date-fns for dates
- Supabase: Postgres, Auth, Storage, Edge Functions (Deno/TypeScript)
- Hosting: Azure Static Web Apps, deployed with a deployment token by the GitHub Action in `.github/workflows/deploy.yml` on every push to `main`, or manually with `npm run deploy` (the Static Web App is not linked to the repo; see SETUP.md section 7). `public/staticwebapp.config.json` handles client-side routing

## Code map

```
src/
  main.tsx              App bootstrap (router, query client, auth provider)
  App.tsx               Route table and the logged-out / inactive / set-password gates
  components/
    Layout.tsx          Sidebar navigation and page shell
    ui.tsx              Small shared pieces: PageHeader, Stat, Badge, Progress, Empty, ErrorNote...
  lib/
    supabase.ts         Supabase client, callFn() for Edge Functions, fetchAll() for >1000 rows
    auth.tsx            Session + profile context (useAuth)
    data.ts             Query hooks (sales, metrics, posts, team) and target progress maths
    media.ts            Upload to storage + media library records
    util.ts             Platform list, money/number formatting, sale and metric helpers
  pages/                One file per screen (see table above), plus Login and SetPassword

supabase/
  migrations/           The whole database: tables, RLS policies, functions, grants, storage bucket
  functions/
    _shared/common.ts   CORS, caller identification (user or scheduler), Blotato client, helpers
    sync-gumroad/       Pull sales from Gumroad into `sales`
    sync-social/        Pull Facebook + Instagram daily stats into `metrics_daily`
    sync-posts/         Update post status and per-post stats from Blotato
    publish-post/       Send a saved post to Blotato, one submission per platform
    ai-write/           Generate or rewrite captions via OpenRouter using the brand settings
    invite-user/        Admin-only: send an invite and set the person's terms
    integrations/       Admin-only: which secrets are set; list Blotato accounts
  cron.sql              Template for the scheduled syncs (run once per project)
  config.toml           Local dev ports and per-function settings
```

## Data model

| Table | Holds | Written by |
| --- | --- | --- |
| `profiles` | One row per user: role, start date, revenue share %, active | Trigger on sign-up; admin; `invite-user` |
| `sales` | One row per Gumroad sale, with fee, refund flags, referrer and a normalised `source` | `sync-gumroad` |
| `metrics_daily` | Account-level stats keyed by (platform, date, metric), e.g. followers, reach, engagement | `sync-social` |
| `posts` | A post: author, media URLs, schedule time, overall status | Front end (author) |
| `post_targets` | One row per platform for a post: caption, first comment, status, Blotato ids, public URL, stats | Front end for drafts; `publish-post` and `sync-posts` afterwards |
| `media_assets` | Media library entries pointing at files in the `media` bucket | Front end |
| `targets` | Monthly targets, optionally per platform or per person | Admin |
| `ideas` | Ideas/tasks board | Any active user |
| `brand_settings` | Single row: brand voice fields and the allowed AI model list | Admin |
| `integration_settings` | Non-secret config: Blotato account mapping, Meta page/Instagram IDs | Admin |
| `payouts` | Revenue share payments recorded as made | Admin |
| `sync_log` | Result of each sync run | Edge Functions |

Also: view `team` (names and roles only, so anyone can see who made a post without seeing share terms), view `sales_net`, and SQL functions `is_admin()`, `is_active_user()`, `has_users()`, `revenue_share_statement()`.

## How the main flows work

**Publishing a post.** The composer saves a `posts` row and one `post_targets` row per platform, then calls `publish-post`. That function looks up the Blotato account for each platform in `integration_settings`, sends one request per platform, and stores the returned submission id. Media is uploaded to Supabase Storage first and Blotato fetches it from the public URL. `sync-posts` (every 15 minutes, or the "Refresh stats" button) polls Blotato for the outcome, saves the public post URL, and later pulls per-post stats, matching Blotato's analytics items to our rows by post URL. Only targets in `draft` or `failed` state are ever sent, so a retry cannot double-post.

**First comments.** Native on Facebook and Instagram. On Threads and X the first comment is sent as a reply in the thread. TikTok has none.

**Stats.** `sync-gumroad` runs hourly and upserts sales by Gumroad sale id, so re-running is safe and refunds are picked up. `sync-social` runs daily and upserts Facebook and Instagram numbers. The front end reads these tables directly and does the summing and charting client-side.

**AI writer.** `ai-write` builds a system prompt from `brand_settings` plus per-platform writing notes, asks the chosen OpenRouter model for JSON, and returns a caption and first comment per platform. The model must be in the admin's allowed list.

**Invites.** `invite-user` uses the Supabase admin API to email an invite, then sets the role, start date and share % and activates the profile. The emailed link lands on the app with `type=invite` in the URL hash, which shows the set-password screen.

## Working on it

```powershell
npm install
npm run dev
```

The app needs a Supabase project to talk to. Either point `.env.local` at a hosted project (see SETUP.md), or run one locally with Docker:

```powershell
supabase start
```

```powershell
supabase functions serve
```

`supabase status` prints the local URL and anon key for `.env.local`. Local ports are in the 5542x range on purpose (see `supabase/config.toml`). `supabase db reset` rebuilds the local database from the migrations. Function secrets for local runs go in `supabase/functions/.env` (git-ignored).

Before committing, run `npm run build`; it type-checks the whole front end.

### Common changes

- **Add a platform:** add it to `PLATFORMS` in `src/lib/util.ts`, add a case to `buildTarget` in `publish-post`, and a writing note in `ai-write`. Blotato must support it.
- **Add an account-level metric or data source** (e.g. Google Analytics): write rows into `metrics_daily` with a new `platform`/`metric` name from a new or existing sync function. The Overview table and target maths pick up `followers`, `reach` and `engagement` automatically.
- **Change the database:** add a new file in `supabase/migrations/` (never edit one that has been deployed), then `supabase db push`.
- **Change a function:** edit it and run `supabase functions deploy <name>`.
- **Release the front end:** push to `main`; the GitHub Action builds and deploys it. For a manual deploy, set `SWA_CLI_DEPLOYMENT_TOKEN` in the shell and run `npm run deploy` (live Supabase values go in `.env.production.local`).

## Gotchas

- **Grants.** New Supabase projects do not grant table access to the `authenticated` role by default. The migration grants it explicitly at the end; a new table needs the same grant as well as RLS policies, or the app gets "permission denied".
- **Row limit.** Supabase returns at most 1000 rows per request. Use `fetchAll()` for anything that can grow (sales, metrics, posts).
- **Auth callback.** Don't call Supabase inside `onAuthStateChange` directly; it can deadlock. `auth.tsx` defers with `setTimeout`.
- **Edge Functions check the caller themselves** (`getCaller` in `_shared/common.ts`), which is why `verify_jwt` is off in `config.toml`. Scheduled calls authenticate with the `x-cron-secret` header.
- **Currency.** Amounts are stored in cents and shown with a `$` sign; there is no currency conversion.

## Status and known gaps

The app was tested end to end against a local Supabase with sample data: sign-up, invites, permissions, drafts, uploads, charts and revenue share maths. As of the initial build, the code that calls external services had **not** been run against live accounts, so treat these as unverified until checked:

- Gumroad sale field names in `sync-gumroad` (written without access to the API docs; the raw response is kept in `sales.raw` to help).
- Meta metric names in `sync-social`. Facebook reach now uses `page_total_media_view_unique` (unique viewers of Page content), the replacement Meta names for the retired reach metric. Meta retires metrics periodically; each is fetched separately so one failure doesn't block the rest, and failures show in the sync log.
- Blotato per-post analytics matching in `sync-posts` (response shape taken from the docs).

Not built: Google Analytics, Google Search Console, and account-level (follower) stats for Threads, X and TikTok. Per-post stats for those three do come through Blotato.
