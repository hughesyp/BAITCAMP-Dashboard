-- Scheduled syncs. Run this once in the Supabase SQL editor AFTER deploying the functions.
-- Replace the two placeholders first:
--   YOUR_PROJECT_REF  -> the project ref from your Supabase URL
--   YOUR_CRON_SECRET  -> the same value you set as the CRON_SECRET function secret
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('sync-gumroad-hourly', '5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-gumroad',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body := '{"days":35}'::jsonb);
$$);

select cron.schedule('sync-social-daily', '20 5 * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-social',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body := '{"days":3}'::jsonb);
$$);

select cron.schedule('sync-posts-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-posts',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb);
$$);

select cron.schedule('sync-mailerlite-6h', '40 */6 * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-mailerlite',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body := '{"days":2}'::jsonb);
$$);
