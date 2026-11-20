# BAITCAMP Dashboard: setup and deployment

A static React app (Vite) hosted on Azure Static Web Apps, with Supabase for logins, database, media storage and server-side functions. All third-party API keys live in Supabase function secrets; the browser never sees them.

## 1. Create the Supabase project

1. Create a project at supabase.com. Note the **project ref** (in the URL) and, under Project Settings → API, the **Project URL** and **anon public key**.
2. In a terminal in this folder:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy
```

`db push` creates the tables, security rules and the `media` storage bucket. `functions deploy` deploys everything in `supabase/functions`.

## 2. Add the API keys (function secrets)

Set only the ones you have; each part of the dashboard switches on when its key exists. Settings → Connections in the app shows which are set.

```powershell
supabase secrets set GUMROAD_ACCESS_TOKEN=...   # Gumroad → Settings → Advanced → Applications → Generate access token
supabase secrets set BLOTATO_API_KEY=...        # Blotato → Settings → API (keep any trailing = characters)
supabase secrets set OPENROUTER_API_KEY=...     # openrouter.ai/keys
supabase secrets set CRON_SECRET=...            # any long random string, used by the scheduler
supabase secrets set META_ACCESS_TOKEN=...      # see section 6
```

## 3. Run it locally

Copy `.env.example` to `.env.local`, fill in the Project URL and anon key, then:

```powershell
npm install
npm run dev
```

Open the address it prints. Because no accounts exist yet, the login page offers **Create the admin account**. That first account is the admin.

**Then turn off public sign-ups:** Supabase → Authentication → Sign In / Providers → disable "Allow new users to sign up". Invites still work. (Even if left on, a self-registered account is created inactive and sees nothing.)

## 4. First-time configuration in the app (as admin)

1. **Settings → Load from Blotato**, choose the account (and page) for each platform, **Save account mapping**.
2. **Settings → Sync now → Gumroad (all history)** to backfill sales.
3. **Brand voice**: fill in the product summary, voice and guidelines; adjust the list of AI models.
4. **Team**: invite each marketer with their start date and revenue share %.
5. **Targets**: add this month's targets.

## 5. Scheduled syncs

Open `supabase/cron.sql`, replace `YOUR_PROJECT_REF` and `YOUR_CRON_SECRET`, and run it once in the Supabase SQL editor. It schedules Gumroad hourly, social stats daily, and post status/stats every 15 minutes.

## 6. Facebook + Instagram stats (Meta)

1. At developers.facebook.com create a **Business** app and add the Facebook Login for Business product.
2. In the Graph API Explorer generate a user token with: `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`.
3. Exchange it for a long-lived token, then call `/me/accounts` to get the **Page access token** and **Page ID** for the BAITCAMP page. A Page token derived from a long-lived user token does not expire.
4. Call `/{page-id}?fields=instagram_business_account` to get the **Instagram business account ID**.
5. `supabase secrets set META_ACCESS_TOKEN=<page token>`, then enter the Page ID and Instagram ID in **Settings**.

Because you are an admin of the app and the page, this works in development mode without Meta app review.

## 7. Deploy to Azure Static Web Apps

The site is uploaded to Azure with a deployment token: automatically by a GitHub Action on every push to `main`, or manually from your computer. The Static Web App itself is not connected to the repo.

### One-time setup

1. In the Azure portal create a **Static Web App**:
   - Plan: **Free**
   - Deployment details → Source: **Other** (not GitHub). This is what stops Azure asking for a repo.
2. When it's created, open it → **Overview** → **Manage deployment token** and copy the token. Treat it like a password: anyone with it can replace the live site. Don't commit it or paste it into chat. You can reset it on the same screen at any time.
3. (Only needed for manual deploys.) In this folder, create a file called `.env.production.local` with the **live** Supabase details (it is git-ignored, and is only used when building for deployment, so `.env.local` can keep pointing at a local Supabase for development):

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

4. Custom domain (`dashboard.baitcamp.net`): in the Static Web App → **Custom domains** → Add → Custom domain on other DNS. Azure gives you a CNAME record to add at your DNS provider, pointing `dashboard` at the `*.azurestaticapps.net` address. HTTPS is set up automatically once it validates.
5. In Supabase → Authentication → URL Configuration set **Site URL** to `https://dashboard.baitcamp.net` and add it to **Redirect URLs**, so invite and password-reset emails link to the live site. If you deploy before the domain is ready, use the `*.azurestaticapps.net` address for now and change it later.

### Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` builds the site and uploads it with the deployment token every time you push to `main`. Azure still isn't linked to the repo; the token is all it uses.

One-time: in GitHub open the repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, and add three secrets:

| Name | Value |
| --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | The deployment token from step 2 |
| `VITE_SUPABASE_URL` | Live Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Live Supabase anon public key |

After that:
- Push to `main` and the site deploys. Progress and errors are in the repo's **Actions** tab.
- To redeploy without a code change, open **Actions** → **Deploy dashboard** → **Run workflow**.
- Pushes that only change `supabase/`, Markdown files or `.claude/` don't trigger a deploy.
- If a secret is missing the run stops at the first step and names it.
- If you reset the deployment token in Azure, update the GitHub secret too.

### Manual deploy (fallback)

You can still deploy straight from your computer, for example to test something before pushing. In PowerShell in this folder, put the token in the session (it is not saved anywhere):

```powershell
$env:SWA_CLI_DEPLOYMENT_TOKEN = "paste-the-deployment-token-here"
```

Then build and upload:

```powershell
npm run deploy
```

This uses the values in `.env.production.local` (step 3). It deploys whatever is in this folder, committed or not, and the next push to `main` will overwrite it.

### Notes
- The front end and the database/functions deploy separately. If a change touched `supabase/`, also run `supabase db push` and/or `supabase functions deploy`.
- `public/staticwebapp.config.json` is copied into the build and handles page refreshes on deep links (e.g. `/posts`).
- `npm audit` reports warnings from the Azure upload tool used by `npm run deploy`; these are development-only and nothing from it ships to the browser (`npm audit --omit=dev` is clean).

## What comes from where

| Data | Source | Notes |
| --- | --- | --- |
| Revenue, sales, sources | Gumroad API | Source is the referrer Gumroad records for each sale |
| Facebook / Instagram account stats | Meta Graph API | Daily followers, reach, engagement |
| Per-post stats | Blotato analytics | Facebook, Instagram, Threads, X, TikTok. Blotato refreshes them a limited number of times over 30 days depending on plan |
| Publishing | Blotato API | First comment is native on Facebook and Instagram; on Threads and X it is posted as a reply; not available on TikTok |

Not built yet: Google Analytics, Search Console, and account-level (follower) stats for Threads, X and TikTok.
