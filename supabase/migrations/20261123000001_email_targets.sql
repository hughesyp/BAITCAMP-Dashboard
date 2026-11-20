-- Allow email subscriber targets.
alter table public.targets drop constraint targets_kind_check;
alter table public.targets add constraint targets_kind_check
  check (kind in ('revenue','sales_count','posts','followers','reach','engagement','email_subscribers','email_new_subscribers'));
