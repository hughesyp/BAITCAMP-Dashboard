-- Sign-in tokens for services connected with OAuth (TikTok).
-- Only the Edge Functions (service role) can read or write this table; the browser never sees tokens.
create table public.oauth_tokens (
  provider text primary key,            -- 'tiktok'
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  account_id text,                      -- TikTok open_id
  account_name text,                    -- shown in Settings
  scope text,
  updated_at timestamptz not null default now()
);

alter table public.oauth_tokens enable row level security;
-- No policies: signed-in users get nothing.
revoke all on public.oauth_tokens from anon, authenticated;
grant all on public.oauth_tokens to service_role;
