-- platform_settings: replace the blanket "Public can read platform settings"
-- policy with an admin-only surface. The public site only needs plan prices,
-- plan limits, demo length and support contacts, so those are served through
-- a narrow view; everything else (internal config) stays admin-only.

drop policy if exists "Public can read platform settings" on public.platform_settings;

-- the admin ALL policy already governs admin reads/writes; authenticated keeps
-- its table grant but non-admins now match no SELECT policy (0 rows).
revoke select on public.platform_settings from anon;

create view public.app_public_settings
as
select
  demo_duration_days,
  basic_plan_price,
  standard_plan_price,
  pro_plan_price,
  enable_demo_signup,
  demo_max_menu_items,
  demo_max_tables,
  basic_max_menu_items,
  basic_max_tables,
  basic_enable_delivery,
  basic_enable_reports,
  standard_max_menu_items,
  standard_max_tables,
  standard_enable_delivery,
  standard_enable_reports,
  premium_max_menu_items,
  premium_max_tables,
  premium_enable_delivery,
  premium_enable_reports,
  premium_enable_branding,
  support_whatsapp,
  support_email
from public.platform_settings;

grant select on public.app_public_settings to anon, authenticated;
