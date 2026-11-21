-- Links to the brand's social profiles (e.g. { "twitter": "https://x.com/..." }), shown on the
-- Social accounts page. Readable by every active user; only admins can change brand_settings.
alter table public.brand_settings add column if not exists profile_links jsonb not null default '{}';
