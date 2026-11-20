-- MailerLite: campaigns (sent ones synced from MailerLite, plus drafts written in the dashboard).
-- Subscriber stats go into metrics_daily with platform 'mailerlite'.

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  mailerlite_id text unique,            -- set once it exists in MailerLite
  author_id uuid references public.profiles(id) on delete set null, -- null = created in MailerLite
  name text not null,
  subject text not null default '',
  body_md text,                         -- email body written in the dashboard (Markdown)
  group_ids text[] not null default '{}',
  ml_status text,                       -- MailerLite status: draft, ready, sent, ... ; null = not pushed yet
  content_pushed boolean not null default false, -- false when MailerLite refused the body (plan limit)
  pushed_at timestamptz,
  sent_at timestamptz,
  stats jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_campaigns_sent_at_idx on public.email_campaigns (sent_at);

alter table public.email_campaigns enable row level security;

create policy email_campaigns_select on public.email_campaigns for select to authenticated
  using (public.is_active_user());
create policy email_campaigns_insert on public.email_campaigns for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid() and mailerlite_id is null and ml_status is null);
-- Authors edit their own unsent drafts; MailerLite fields are only written by the server.
create policy email_campaigns_update on public.email_campaigns for update to authenticated
  using ((author_id = auth.uid() and coalesce(ml_status, 'draft') = 'draft') or public.is_admin())
  with check ((author_id = auth.uid() and coalesce(ml_status, 'draft') = 'draft') or public.is_admin());
create policy email_campaigns_delete on public.email_campaigns for delete to authenticated
  using ((author_id = auth.uid() and mailerlite_id is null) or public.is_admin());

-- Column-level guard: signed-in users may only change the editable draft fields.
revoke update on public.email_campaigns from authenticated;
grant select, insert, delete on public.email_campaigns to authenticated;
grant update (name, subject, body_md, group_ids, updated_at) on public.email_campaigns to authenticated;
grant all on public.email_campaigns to service_role;
