-- ============================================================
-- tables: public guests only need the table label for the QR
-- table they scanned. Scope public reads to active, approved,
-- non-suspended outlets and limit anon to the display columns.
-- ============================================================
drop policy if exists "Public can view tables" on public.tables;
create policy "Public can view active outlet tables"
  on public.tables
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.outlets o
      where o.id = tables.outlet_id
        and o.is_active = true
        and o.suspended = false
        and o.approval_status = 'approved'
    )
  );

revoke all on public.tables from anon;
grant select (id, outlet_id, table_number, name) on public.tables to anon;

-- ============================================================
-- platform_settings: the public site only displays plan prices,
-- limits, demo length and support contacts. Restrict the anon
-- grant to exactly those columns so internal config stays hidden.
-- ============================================================
revoke all on public.platform_settings from anon;
grant select (
  id,
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
) on public.platform_settings to anon;
