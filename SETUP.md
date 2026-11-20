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
supabase secrets set LINKEDIN_ACCESS_TOKEN=...  # see section 7
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

## 7. LinkedIn stats

1. At linkedin.com/developers create an app linked to the BAITCAMP company page and request the **Community Management API** product (LinkedIn reviews this; it can take days or weeks).
2. Once approved, generate a token with `r_organization_social` and `rw_organization_admin` scopes (Auth tab → OAuth token tools).
3. `supabase secrets set LINKEDIN_ACCESS_TOKEN=...` and enter the organization ID (the number in the company page admin URL) in **Settings**.
4. LinkedIn tokens expire after about 60 days; repeat step 2-3 when the sync log shows an auth error.

LinkedIn does not provide analytics for personal profiles, only company pages.

## 8. Deploy to Azure Static Web Apps

1. Push this repo to GitHub.
2. In the Azure portal create a **Static Web App** (Free plan), connect the GitHub repo and branch `main`, build preset **React**, app location `/`, output location `dist`. Azure adds its own deploy workflow to the repo.
3. In the GitHub repo add two **Actions secrets or variables** and expose them to the build step of the generated workflow as environment variables:

```yaml
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

4. In Supabase → Authentication → URL Configuration set **Site URL** to the Azure address (or your custom domain) and add it to **Redirect URLs**, so invite and password-reset emails link back to the live site.

`public/staticwebapp.config.json` already handles page refreshes on deep links.

## What comes from where

| Data | Source | Notes |
| --- | --- | --- |
| Revenue, sales, sources | Gumroad API | Source is the referrer Gumroad records for each sale |
| Facebook / Instagram account stats | Meta Graph API | Daily followers, reach, engagement |
| LinkedIn account stats | LinkedIn API | Company pages only |
| Per-post stats | Blotato analytics | Facebook, Instagram, Threads, X, TikTok. Not LinkedIn. Blotato refreshes them a limited number of times over 30 days depending on plan |
| Publishing | Blotato API | First comment is native on Facebook and Instagram; on Threads and X it is posted as a reply; not available on LinkedIn or TikTok |

Not built yet: Google Analytics, Search Console, and account-level (follower) stats for Threads, X and TikTok.
