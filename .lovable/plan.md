
# Plan: Inventory System + Fries Variants + Notifications + Mobile UI

Existing app stays intact. Only additive/surgical changes.

## 1. Database (one migration)

New tables and columns:

**`menu_items` (extend)**
- `track_inventory boolean default false`
- `unit_type text default 'qty'` — `'qty' | 'kg'`
- `has_variants boolean default false` — true for fries-style sized items

**`menu_item_variants` (new)** — per-size config for fries-style items
- `id, menu_item_id, label` (Small/Medium/Large/Family)
- `price numeric`
- `weight_grams numeric` (backend-only, used for deduction)
- `sort_order int`
- RLS: owner of outlet manages; public can read.

**`inventory` (new)** — one row per menu_item per outlet
- `id, outlet_id, menu_item_id`
- `stock numeric` (units = qty count, or grams when unit_type='kg')
- `low_threshold int default 10`
- `critical_threshold int default 5`
- `updated_at`
- Unique(outlet_id, menu_item_id)
- RLS: outlet owner full; public read (so customer menu can hide sold-out).

**`order_items` (extend)**
- `variant_id uuid null` — which variant was ordered (for fries)
- `variant_label text null` — denormalized for receipts

**`orders` (extend)**
- `inventory_applied boolean default false` — guards against double deduction/restore

**Triggers / functions:**
- `fn_apply_inventory(order_id)` — for each order_item: if menu_item has variants, deduct `quantity * variant.weight_grams` from inventory.stock; else deduct `quantity`. Sets `inventory_applied=true`. No-op if already applied.
- `fn_restore_inventory(order_id)` — reverse. Sets `inventory_applied=false`.
- Trigger on `orders` UPDATE:
  - On status transition into `accepted` (from pending) and not yet applied → apply.
  - On status transition to `cancelled` while applied → restore.
- Trigger on `menu_items` INSERT → auto-create `inventory` row (stock=0, track_inventory=false by default so existing flows unaffected).
- Backfill: insert inventory rows for all existing menu_items.

Low-stock notifications: after deduction, if stock crossed threshold, insert into `outlet_messages` (`kind='low_stock_warning'` or `'low_stock_critical'`) — reuses existing notification UI.

## 2. Inventory page (new)

`src/pages/dashboard/InventoryPage.tsx` + route in `DashboardLayout` sidebar.

- List grouped by category.
- Columns: Image, Name, Unit (Qty/KG), Stock (colored number), Threshold, +/- adjust, Save.
- Color rules on stock number:
  - `> 10` green, `=10` pink, `≤ 5` red.
  - For kg items, compare on units = floor(grams/100) or just on configured threshold (we'll treat threshold as the same scale as stock).
- Toggle "Track inventory" per item.
- For variant items: show parent stock in grams + variants list (read-only sizes) below.

## 3. Menu Add/Edit — Fries variant fields

In `MenuManagement.tsx` Add/Edit dialogs:
- New checkbox "Track inventory" → exposes `unit_type` select (Qty / KG) and starting stock.
- New checkbox "This item has sizes (e.g. Fries)" → exposes repeatable rows: Label / Weight (g, backend) / Price.
- When `has_variants=true`, the base `price` becomes the smallest variant's price for display fallback; UI hint: "Customer will see each size with its own price. Grams are backend-only."

Mutations write to `menu_item_variants` and `inventory`.

## 4. Public menu — variant picker

`MenuItemCard.tsx` + `CartSheet.tsx`:
- If item `has_variants`, render size buttons (label + price) instead of single Add. No grams shown anywhere.
- Cart line stores `variant_id` + `variant_label` + variant price. Submitted into `order_items.variant_id` + `variant_label` + `price`.
- Hide items where `track_inventory=true` and stock ≤ 0 (or show "Sold out" badge, disabled).

## 5. Notifications read/unread fix

`outlet_messages` already has `read_at`. Audit `useOutletNotifications.ts` + `OutletNotificationBell.tsx`:
- Unread count = `read_at IS NULL`.
- On opening the bell popover, mark currently-visible items as read (UPDATE `read_at = now()`).
- Don't re-toast notifications already seen — gate toasts on `read_at IS NULL && created_at > session_start`.
- Same for `AdminNotificationBell`.

Low-stock messages flow through this same channel automatically.

## 6. Mobile menu UI fix

`MenuManagement.tsx` item cards:
- Switch to responsive layout: `flex-col sm:flex-row` with proper gap.
- Name: `line-clamp-2`, no truncate on mobile.
- Tags wrap below name.
- Price block on its own row on mobile.
- Action row (toggle / edit / delete) separated with `gap-3`, larger hit targets (`p-2`).
- Image 14×14 on mobile, 12×12 on desktop.

## 7. Files

**New**
- `supabase/migrations/<ts>_inventory.sql`
- `src/pages/dashboard/InventoryPage.tsx`
- `src/hooks/useInventory.ts`
- `src/components/menu/VariantEditor.tsx`
- `src/components/public-menu/VariantPicker.tsx`

**Edited**
- `src/pages/dashboard/MenuManagement.tsx` (variant + inventory fields, mobile cards)
- `src/components/public-menu/MenuItemCard.tsx` (variant picker, sold-out)
- `src/components/public-menu/CartSheet.tsx` (variant in cart lines + order submit)
- `src/components/DashboardLayout.tsx` (Inventory nav link)
- `src/routes/` add inventory route
- `src/hooks/useOutletNotifications.ts` (read-state fix)
- `src/components/outlet/OutletNotificationBell.tsx` (mark-as-read on open)
- `src/components/admin/AdminNotificationBell.tsx` (same fix)
- `src/hooks/useData.ts` (menu queries to include variants + inventory)

## 8. Out of scope (kept stable)
- Auth, cancellation flow, POS cash dialog, reports — untouched except inventory deduction hooks fire automatically via DB triggers.

I'll start with the migration (await your approval), then ship the code in one batch.
