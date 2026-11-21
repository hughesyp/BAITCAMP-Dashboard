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
supabase secrets set NOTION_API_KEY=...         # see section 6b
supabase secrets set MAILERLITE_API_KEY=...     # see section 6c
supabase secrets set CRON_SECRET=...            # any long random string, used by the scheduler
supabase secrets set META_ACCESS_TOKEN=...      # see section 6
supabase secrets set TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=...   # see section 6d
supabase secrets set THREADS_APP_ID=... THREADS_APP_SECRET=...       # see section 6e
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
3. **Settings → AI models**: adjust the list of OpenRouter models marketers can pick. **Settings → Brand guide pages** lists the Notion pages (the four BAITCAMP pages are filled in already).
4. **Team**: invite each marketer with their start date and revenue share %.
5. **Targets**: add this month's targets.

## 5. Scheduled syncs

Open `supabase/cron.sql`, replace `YOUR_PROJECT_REF` and `YOUR_CRON_SECRET`, and run it once in the Supabase SQL editor. It schedules Gumroad hourly, social stats daily, post status/stats every 15 minutes, and MailerLite every 6 hours. If you already ran it before, run only the new `sync-mailerlite-6h` block at the end.

## 6. Facebook + Instagram stats (Meta)

1. At developers.facebook.com create a **Business** app and add the Facebook Login for Business product.
2. In the Graph API Explorer generate a user token with: `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`.
3. Exchange it for a long-lived token, then call `/me/accounts` to get the **Page access token** and **Page ID** for the BAITCAMP page. A Page token derived from a long-lived user token does not expire.
4. Call `/{page-id}?fields=instagram_business_account` to get the **Instagram business account ID**.
5. `supabase secrets set META_ACCESS_TOKEN=<page token>`, then enter the Page ID and Instagram ID in **Settings**.

Because you are an admin of the app and the page, this works in development mode without Meta app review.

## 6b. Brand guide from Notion

The Brand guide page shows your Notion pages (ideal customers, brand voice, branding) read-only, and the AI writer follows them. Pages are read live from Notion each time; nothing is copied into the database, and editing stays in Notion.

1. Go to notion.so/profile/integrations → **New integration**. Type: **Internal**, workspace: yours. Under Capabilities tick **Read content** only (untick insert and update content, so the dashboard can never change Notion).
2. Copy the **Internal Integration Secret** and set it (don't paste it into chat):

```powershell
supabase secrets set NOTION_API_KEY=your-integration-secret
```

3. Give the integration access to the pages: open each page in Notion → **⋯** → **Connections** → add your integration. Sharing the parent BAITCAMP page covers every page under it.
4. In the dashboard open **Brand guide**. If a page shows "not found", it hasn't been shared with the integration yet.

To show different or extra pages, paste their Notion links (one per line) into **Settings → Brand guide pages**. Only the pages listed there can be viewed through the dashboard, even if the integration can see more.

## 6c. MailerLite

Email stats (subscribers, growth, campaign results) and email drafting.

1. In MailerLite go to **Integrations → MailerLite API** (dashboard.mailerlite.com/integrations/api) → **Generate new token**. It's shown once. The key belongs to the MailerLite user who made it and stops working if that user is removed.
2. Set it (don't paste it into chat):

```powershell
supabase secrets set MAILERLITE_API_KEY=your-token
```

3. In the dashboard, **Settings → MailerLite sender**: enter the from email (it must already be verified in MailerLite) and from name.
4. **Settings → Sync now → MailerLite (90 days)** for the first load. After that the scheduled sync (section 5) runs every 6 hours.

How drafting works: marketers write the email under **Email drafts** (with the AI writer) and press **Send to MailerLite as draft**. It appears in MailerLite as a draft campaign; nothing is sent until you send or schedule it there. Check the footer in MailerLite before sending (MailerLite may require your postal address).

Plan limits: MailerLite only accepts email content through its API on some plans. If yours refuses it, the draft is still created (name, subject, sender, groups) and the dashboard says so; use **Copy email HTML** and paste it into the draft with MailerLite's custom HTML editor. MailerLite's API can't list or apply your saved templates, so dashboard emails use a built-in BAITCAMP layout instead.

MailerLite doesn't keep a history of the subscriber total, so the "Active subscribers" figure builds up from the day it's connected. New subscribers and unsubscribes per day can be backfilled for 90 days.

## 6d. TikTok stats

TikTok post stats (views, likes, comments on posts published through the dashboard) already come from Blotato. This section adds **account** stats: followers, plus daily views and engagements across all your public videos.

1. Go to developers.tiktok.com, log in, and open **Manage apps** → **Connect an app**. Fill in the app details (name, icon, category, description). TikTok asks for a terms of service and privacy policy URL; pages on baitcamp.net are fine.
2. Platform: **Web**, website `https://dashboard.baitcamp.net`.
3. Under **Products**, add **Login Kit** (there is no separate "Display API" product to add). Then open the **Scopes** section (left menu) → **Add scopes** and add `user.info.profile`, `user.info.stats` and `video.list`. `user.info.basic` is already there.
4. In Login Kit, add the redirect URI exactly: `https://dashboard.baitcamp.net/settings/tiktok` (Settings → TikTok stats in the dashboard shows the exact address for the site you're on). TikTok only accepts https addresses, so connecting has to be done on the live site, not from a local copy.
5. Choose how to run it:
   - **Sandbox (try this first):** in the app, create a **Sandbox**, then under target users add the BAITCAMP TikTok account (you log in to it there). A sandbox has its own client key and secret; use those. No review needed, but it only works for the accounts added as target users, which is all we need.
   - **Production:** if TikTok won't give the stats permissions in sandbox, submit the app for review. Explain it's an internal dashboard that only reads the business's own TikTok account stats; a short screen recording of Settings → Connect TikTok helps.
6. Copy the **Client key** and **Client secret** and set them (don't paste them into chat):

```powershell
supabase secrets set TIKTOK_CLIENT_KEY=your-client-key TIKTOK_CLIENT_SECRET=your-client-secret
```

7. In the dashboard, **Settings → TikTok stats → Connect TikTok**, sign in with the BAITCAMP TikTok account and allow everything it asks for. Then **Sync now → Social stats**.

How the numbers work: TikTok's API gives running totals only (followers, and views/likes/comments/shares per video), not daily figures. The daily sync saves the totals each day and works out the day's views and engagements as the change since the day before, so TikTok figures start from the day it's connected and there's no backfill or reach figure. It covers your 200 most recent public videos.

The sign-in renews itself every time the daily sync runs. If the sync stops for several months the sign-in expires, and Settings shows the date to reconnect by.

## 6e. Threads stats

Threads post stats already come from Blotato. This section adds **account** stats: followers, plus daily profile views, engagements (likes, replies, reposts and quotes on your posts) and link clicks. It's free.

1. At developers.facebook.com → **My Apps** → **Create app**, choose the use case **Access the Threads API**. Meta may not let you add this use case to the Facebook app from section 6, so a separate app is fine.
2. In the new app open **Use cases** → **Access the Threads API** → **Customize**:
   - **Permissions**: add `threads_manage_insights` (`threads_basic` is already there).
   - **Settings**: under **Redirect Callback URLs** add exactly `https://dashboard.baitcamp.net/settings/threads` (Settings → Threads stats in the dashboard shows the exact address). Meta also asks for uninstall and delete callback URLs; `https://dashboard.baitcamp.net` is fine for both. Connecting has to be done on the live site, as Meta only accepts https addresses.
   - On the same Settings screen, copy the **Threads app ID** and **Threads app secret**. These are different from the app's main App ID.
3. **App roles** → **Roles** → **Add people** → **Threads Tester**, and add the BAITCAMP Threads account. Then accept the invite in Threads: open the Threads app or threads.com as that account → **Settings** → **Account** → **Website permissions** → **Invites**. While the app is in development mode only tester accounts can connect, which is all we need, so no app review is required.
4. Set the ID and secret (don't paste them into chat):

```powershell
supabase secrets set THREADS_APP_ID=your-threads-app-id THREADS_APP_SECRET=your-threads-app-secret
```

5. In the dashboard, **Settings → Threads stats → Connect Threads**, sign in as the BAITCAMP Threads account and allow access. Then **Sync now → Social stats**.

How the numbers work: Threads reports profile views, likes, replies, reposts, quotes and link clicks per day, but no reach or impressions. Followers is a current total only, so follower growth builds up from the day it's connected.

The sign-in lasts 60 days and renews itself with each daily sync. If renewing fails, the sync keeps working until the date shown in Settings; reconnect before then.

**X (Twitter):** X charges for API access, so X stats aren't pulled in. Enter the profile address in **Settings → X (Twitter) profile** and the Social accounts page links to it.

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
| TikTok account stats | TikTok Display API | Followers; daily views and engagements worked out from running totals |
| Threads account stats | Threads API (Meta) | Followers; daily profile views, engagements and link clicks |
| Per-post stats | Blotato analytics | Facebook, Instagram, Threads, X, TikTok. Blotato refreshes them a limited number of times over 30 days depending on plan |
| Publishing | Blotato API | First comment is native on Facebook and Instagram; on Threads and X it is posted as a reply; not available on TikTok |
| Brand guide, AI writer's brand rules | Notion API | Read live and read-only; nothing stored |
| Email subscribers, growth, campaign stats | MailerLite API | Synced every 6 hours |
| Email drafts | Dashboard → MailerLite | Created as MailerLite drafts only; sending happens in MailerLite |

Not built yet: Google Analytics, Search Console, and account-level stats for X (the Social accounts page links to the X profile instead).
