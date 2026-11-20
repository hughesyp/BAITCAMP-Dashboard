-- Brand voice, branding and ideal-customer docs are now read live from Notion (nothing is
-- copied into the database). The editable brand fields are removed; brand_settings keeps
-- only the AI model list.

alter table public.brand_settings
  drop column product_summary,
  drop column voice,
  drop column guidelines,
  drop column dos,
  drop column donts,
  drop column hashtags,
  drop column links;

-- Which Notion pages the dashboard shows, in display order. Editable in Settings.
insert into public.integration_settings (key, value) values ('notion', jsonb_build_object('pages', jsonb_build_array(
  '3ebee8e02f7e812fb410cadd122f2493',  -- Ideal Customer: Colton (US/Canada, primary)
  '3ebee8e02f7e81c48d6fc8f4d11407c9',  -- Ideal Customer: Dave (UK, secondary)
  '3f2ee8e02f7e813eb778c205c84f0f54',  -- Brand Voice
  '947ff12a80e24a1da0089e474cfbd9fa'   -- Branding
)))
on conflict (key) do nothing;
