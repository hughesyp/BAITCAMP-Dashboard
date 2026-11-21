-- Every post on the connected accounts (Facebook, Instagram, Threads, TikTok), with stats
-- straight from each platform. Filled by sync-posts. post_target_id links a post that was
-- published through the dashboard to its post_targets row.
create table public.social_posts (
  platform text not null,
  native_id text not null,
  permalink text,
  caption text,
  media_type text,
  thumbnail_url text,
  published_at timestamptz,
  metrics jsonb not null default '{}',   -- {views, reach, likes, comments, shares, saves, reposts, quotes, clicks}
  metrics_updated_at timestamptz,
  post_target_id uuid references public.post_targets(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (platform, native_id)
);
create index social_posts_published_idx on public.social_posts (published_at desc);
create index social_posts_target_idx on public.social_posts (post_target_id);

alter table public.social_posts enable row level security;
create policy social_posts_select on public.social_posts for select to authenticated using (public.is_active_user());
revoke all on public.social_posts from anon, authenticated;
grant select on public.social_posts to authenticated;
grant all on public.social_posts to service_role;
