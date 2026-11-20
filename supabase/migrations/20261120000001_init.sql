-- BAITCAMP Dashboard schema
create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'marketer' check (role in ('admin','marketer')),
  start_date date not null default current_date,
  rev_share_pct numeric(5,2) not null default 0 check (rev_share_pct >= 0 and rev_share_pct <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- Create a profile for each new auth user. The very first user becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, email, full_name, role, start_date, rev_share_pct, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    -- role / start date / share are never taken from user-supplied metadata;
    -- the invite-user function sets them with the service role afterwards.
    case when first_user then 'admin' else 'marketer' end,
    current_date,
    0,
    first_user  -- everyone else stays inactive until an admin invites/activates them
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Gumroad sales ----------
create table public.sales (
  id text primary key,                 -- Gumroad sale id
  created_at timestamptz not null,
  product_id text,
  product_name text,
  price_cents integer not null default 0,
  fee_cents integer not null default 0,
  currency text not null default 'usd',
  refunded boolean not null default false,
  partially_refunded boolean not null default false,
  chargedback boolean not null default false,
  referrer text,
  source text,                         -- normalised referrer (facebook, instagram, direct, ...)
  quantity integer not null default 1,
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index sales_created_at_idx on public.sales (created_at);

-- ---------- daily account-level metrics ----------
create table public.metrics_daily (
  platform text not null,              -- facebook, instagram, linkedin, threads, twitter, tiktok, ga4, gsc
  date date not null,
  metric text not null,                -- followers, reach, impressions, engagement, profile_views, clicks, sessions...
  value numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (platform, date, metric)
);

-- ---------- media library ----------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  storage_path text not null,
  public_url text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  tags text[] not null default '{}',
  is_brand_asset boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- posts ----------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  title text,
  media_urls text[] not null default '{}',
  scheduled_at timestamptz,            -- null = publish immediately
  status text not null default 'draft' check (status in ('draft','queued','scheduled','published','partial','failed')),
  created_at timestamptz not null default now()
);

create table public.post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  platform text not null,
  caption text not null default '',
  first_comment text,
  options jsonb not null default '{}', -- e.g. {"mediaType":"reel"}
  status text not null default 'draft' check (status in ('draft','in-progress','scheduled','published','failed')),
  blotato_submission_id text,
  blotato_post_id text,                -- published post id used for analytics
  public_url text,
  error_message text,
  published_at timestamptz,
  metrics jsonb not null default '{}', -- latest {likes, comments, views, reach, shares...}
  metrics_updated_at timestamptz,
  unique (post_id, platform)
);
create index post_targets_status_idx on public.post_targets (status);

-- ---------- targets ----------
create table public.targets (
  id uuid primary key default gen_random_uuid(),
  month date not null,                 -- first day of month
  kind text not null check (kind in ('revenue','sales_count','posts','followers','reach','engagement')),
  platform text,                       -- null = all platforms
  marketer_id uuid references public.profiles(id) on delete cascade, -- null = whole team
  target_value numeric not null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- ideas / tasks ----------
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  title text not null,
  body text,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due_date date,
  created_at timestamptz not null default now()
);

-- ---------- brand voice / guidelines (single row) ----------
create table public.brand_settings (
  id integer primary key default 1 check (id = 1),
  product_summary text not null default '',
  voice text not null default '',
  guidelines text not null default '',
  dos text not null default '',
  donts text not null default '',
  hashtags text not null default '',
  links text not null default '',
  ai_models text[] not null default '{anthropic/claude-sonnet-4.5,openai/gpt-4o-mini,google/gemini-2.5-flash}',
  updated_at timestamptz not null default now()
);
insert into public.brand_settings (id) values (1);

-- ---------- integration config (non-secret ids only; secrets live in Edge Function secrets) ----------
create table public.integration_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------- sync log ----------
create table public.sync_log (
  id bigint generated always as identity primary key,
  source text not null,
  ok boolean not null,
  message text,
  ran_at timestamptz not null default now()
);

-- ---------- payouts ----------
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  marketer_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  amount_cents integer not null,
  currency text not null default 'usd',
  paid_at timestamptz not null default now(),
  note text,
  unique (marketer_id, month)
);

-- ---------- revenue share ----------
-- Net = price - Gumroad fee, excluding refunded / charged-back sales.
create or replace view public.sales_net with (security_invoker = true) as
  select
    id, created_at, product_name, currency, source, referrer,
    price_cents, fee_cents,
    case when refunded or chargedback then 0 else price_cents - fee_cents end as net_cents,
    (refunded or chargedback) as reversed
  from public.sales;

-- Monthly statement for one marketer. Marketers can only request their own.
create or replace function public.revenue_share_statement(p_marketer uuid)
returns table (
  month date,
  sales_count bigint,
  net_cents bigint,
  share_cents bigint,
  paid_cents bigint,
  paid_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  prof profiles%rowtype;
begin
  if p_marketer <> auth.uid() and not is_admin() then
    raise exception 'not allowed';
  end if;
  select * into prof from profiles where id = p_marketer;
  if not found then return; end if;

  return query
  with months as (
    select generate_series(date_trunc('month', prof.start_date::timestamp),
                           date_trunc('month', now()::timestamp),
                           interval '1 month')::date as m
  ),
  agg as (
    select date_trunc('month', s.created_at)::date as m,
           count(*) filter (where not (s.refunded or s.chargedback)) as cnt,
           coalesce(sum(case when s.refunded or s.chargedback then 0 else s.price_cents - s.fee_cents end), 0) as net
    from sales s
    where s.created_at >= prof.start_date
    group by 1
  )
  select months.m,
         coalesce(agg.cnt, 0)::bigint,
         coalesce(agg.net, 0)::bigint,
         round(coalesce(agg.net, 0) * prof.rev_share_pct / 100.0)::bigint,
         coalesce(p.amount_cents, 0)::bigint,
         p.paid_at
  from months
  left join agg on agg.m = months.m
  left join payouts p on p.marketer_id = p_marketer and p.month = months.m
  order by months.m desc;
end;
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.sales enable row level security;
alter table public.metrics_daily enable row level security;
alter table public.media_assets enable row level security;
alter table public.posts enable row level security;
alter table public.post_targets enable row level security;
alter table public.targets enable row level security;
alter table public.ideas enable row level security;
alter table public.brand_settings enable row level security;
alter table public.integration_settings enable row level security;
alter table public.sync_log enable row level security;
alter table public.payouts enable row level security;

-- Team directory (names for "who posted this") without exposing rev share terms.
create or replace view public.team with (security_invoker = false) as
  select id, full_name, role, active from public.profiles where public.is_active_user();
grant select on public.team to authenticated;

-- profiles: own row, or everything for admin. Only admin can change.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- shared read for active users; writes by service role (Edge Functions) only
create policy sales_select on public.sales for select to authenticated using (public.is_active_user());
create policy metrics_select on public.metrics_daily for select to authenticated using (public.is_active_user());
create policy metrics_admin_write on public.metrics_daily for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy sync_log_select on public.sync_log for select to authenticated using (public.is_admin());

-- media
create policy media_select on public.media_assets for select to authenticated using (public.is_active_user());
create policy media_insert on public.media_assets for insert to authenticated
  with check (public.is_active_user() and uploaded_by = auth.uid());
create policy media_update on public.media_assets for update to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());
create policy media_delete on public.media_assets for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- posts: everyone sees all; authors manage their own drafts; admin manages all
create policy posts_select on public.posts for select to authenticated using (public.is_active_user());
create policy posts_insert on public.posts for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid());
create policy posts_update on public.posts for update to authenticated
  using (author_id = auth.uid() or public.is_admin());
create policy posts_delete on public.posts for delete to authenticated
  using ((author_id = auth.uid() and status = 'draft') or public.is_admin());

create policy post_targets_select on public.post_targets for select to authenticated using (public.is_active_user());
create policy post_targets_write on public.post_targets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.is_admin())));

-- targets: all read, admin write
create policy targets_select on public.targets for select to authenticated using (public.is_active_user());
create policy targets_admin_write on public.targets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ideas: all read and add; anyone active can update status; admin or creator deletes
create policy ideas_select on public.ideas for select to authenticated using (public.is_active_user());
create policy ideas_insert on public.ideas for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
create policy ideas_update on public.ideas for update to authenticated using (public.is_active_user());
create policy ideas_delete on public.ideas for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- brand: all read, admin write
create policy brand_select on public.brand_settings for select to authenticated using (public.is_active_user());
create policy brand_admin_update on public.brand_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- integrations: admin only
create policy integrations_admin on public.integration_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- payouts: own or admin read; admin write
create policy payouts_select on public.payouts for select to authenticated
  using (marketer_id = auth.uid() or public.is_admin());
create policy payouts_admin_write on public.payouts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- storage bucket for media ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 524288000)
on conflict (id) do nothing;

create policy media_bucket_read on storage.objects for select using (bucket_id = 'media');
create policy media_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_active_user());
create policy media_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (owner = auth.uid() or public.is_admin()));

-- ---------- first-run helper ----------
-- Lets the login screen offer "create the first admin account" only while no users exist.
create or replace function public.has_users() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles);
$$;
grant execute on function public.has_users() to anon, authenticated;
