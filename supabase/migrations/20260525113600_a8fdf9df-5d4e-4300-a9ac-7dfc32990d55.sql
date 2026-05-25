
-- 1. menu_items extensions
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'qty',
  ADD COLUMN IF NOT EXISTS has_variants boolean NOT NULL DEFAULT false;

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_unit_type_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_unit_type_check CHECK (unit_type IN ('qty','kg'));

-- 2. menu_item_variants
CREATE TABLE IF NOT EXISTS public.menu_item_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  label text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  weight_grams numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_variants_menu_item ON public.menu_item_variants(menu_item_id);

ALTER TABLE public.menu_item_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view variants" ON public.menu_item_variants;
CREATE POLICY "Public can view variants" ON public.menu_item_variants
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Active owner manages variants" ON public.menu_item_variants;
CREATE POLICY "Active owner manages variants" ON public.menu_item_variants
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_variants.menu_item_id AND public.owns_active_outlet(mi.outlet_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_variants.menu_item_id AND public.owns_active_outlet(mi.outlet_id)));

DROP TRIGGER IF EXISTS trg_variants_updated ON public.menu_item_variants;
CREATE TRIGGER trg_variants_updated
  BEFORE UPDATE ON public.menu_item_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. inventory
CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  stock numeric NOT NULL DEFAULT 0,
  low_threshold numeric NOT NULL DEFAULT 10,
  critical_threshold numeric NOT NULL DEFAULT 5,
  last_low_notified_at timestamptz,
  last_critical_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, menu_item_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_outlet ON public.inventory(outlet_id);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view inventory" ON public.inventory;
CREATE POLICY "Public can view inventory" ON public.inventory
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Active owner manages inventory" ON public.inventory;
CREATE POLICY "Active owner manages inventory" ON public.inventory
  FOR ALL
  USING (public.owns_active_outlet(outlet_id))
  WITH CHECK (public.owns_active_outlet(outlet_id));

DROP TRIGGER IF EXISTS trg_inventory_updated ON public.inventory;
CREATE TRIGGER trg_inventory_updated
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. order_items extensions
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id uuid,
  ADD COLUMN IF NOT EXISTS variant_label text;

-- 5. orders extension
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS inventory_applied boolean NOT NULL DEFAULT false;

-- 6. auto-create inventory row when a menu_item is added
CREATE OR REPLACE FUNCTION public.fn_create_inventory_for_menu_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inventory (outlet_id, menu_item_id, stock)
  VALUES (NEW.outlet_id, NEW.id, 0)
  ON CONFLICT (outlet_id, menu_item_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_item_create_inventory ON public.menu_items;
CREATE TRIGGER trg_menu_item_create_inventory
  AFTER INSERT ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_create_inventory_for_menu_item();

-- Backfill existing menu items
INSERT INTO public.inventory (outlet_id, menu_item_id, stock)
SELECT mi.outlet_id, mi.id, 0
FROM public.menu_items mi
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory inv
  WHERE inv.outlet_id = mi.outlet_id AND inv.menu_item_id = mi.id
);

-- 7. apply / restore inventory
CREATE OR REPLACE FUNCTION public.fn_apply_inventory(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outlet uuid;
  v_already boolean;
  v_item RECORD;
  v_deduct numeric;
  v_stock_after numeric;
  v_low numeric;
  v_crit numeric;
  v_track boolean;
  v_name text;
  v_outlet_name text;
BEGIN
  SELECT outlet_id, inventory_applied INTO v_outlet, v_already
  FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF v_outlet IS NULL OR v_already THEN RETURN; END IF;

  FOR v_item IN
    SELECT oi.menu_item_id, oi.variant_id, oi.quantity, mi.track_inventory, mi.has_variants, mi.name AS item_name
    FROM public.order_items oi
    JOIN public.menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = _order_id
  LOOP
    IF NOT v_item.track_inventory THEN CONTINUE; END IF;

    IF v_item.has_variants AND v_item.variant_id IS NOT NULL THEN
      SELECT v_item.quantity * COALESCE(weight_grams, 0) INTO v_deduct
        FROM public.menu_item_variants WHERE id = v_item.variant_id;
    ELSE
      v_deduct := v_item.quantity;
    END IF;

    IF COALESCE(v_deduct, 0) <= 0 THEN CONTINUE; END IF;

    UPDATE public.inventory
       SET stock = GREATEST(stock - v_deduct, 0),
           updated_at = now()
     WHERE outlet_id = v_outlet AND menu_item_id = v_item.menu_item_id
    RETURNING stock, low_threshold, critical_threshold INTO v_stock_after, v_low, v_crit;

    -- Low-stock notification (debounced per row)
    IF v_stock_after IS NOT NULL THEN
      SELECT name INTO v_outlet_name FROM public.outlets WHERE id = v_outlet;
      IF v_stock_after <= v_crit THEN
        UPDATE public.inventory
           SET last_critical_notified_at = now()
         WHERE outlet_id = v_outlet AND menu_item_id = v_item.menu_item_id
           AND (last_critical_notified_at IS NULL OR last_critical_notified_at < now() - interval '6 hours');
        IF FOUND THEN
          INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata)
          VALUES (v_outlet, 'low_stock_critical',
            'Urgent: ' || v_item.item_name || ' stock is critically low',
            v_item.item_name || ' stock is at ' || v_stock_after::text || '. Restock immediately.',
            jsonb_build_object('menu_item_id', v_item.menu_item_id, 'stock', v_stock_after));
        END IF;
      ELSIF v_stock_after <= v_low THEN
        UPDATE public.inventory
           SET last_low_notified_at = now()
         WHERE outlet_id = v_outlet AND menu_item_id = v_item.menu_item_id
           AND (last_low_notified_at IS NULL OR last_low_notified_at < now() - interval '12 hours');
        IF FOUND THEN
          INSERT INTO public.outlet_messages (outlet_id, kind, title, body, metadata)
          VALUES (v_outlet, 'low_stock_warning',
            'Low stock warning: ' || v_item.item_name,
            v_item.item_name || ' stock is reaching the minimum level (' || v_stock_after::text || ' left).',
            jsonb_build_object('menu_item_id', v_item.menu_item_id, 'stock', v_stock_after));
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.orders SET inventory_applied = true WHERE id = _order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_restore_inventory(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outlet uuid;
  v_applied boolean;
  v_item RECORD;
  v_add numeric;
BEGIN
  SELECT outlet_id, inventory_applied INTO v_outlet, v_applied
  FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF v_outlet IS NULL OR NOT v_applied THEN RETURN; END IF;

  FOR v_item IN
    SELECT oi.menu_item_id, oi.variant_id, oi.quantity, mi.track_inventory, mi.has_variants
    FROM public.order_items oi
    JOIN public.menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = _order_id
  LOOP
    IF NOT v_item.track_inventory THEN CONTINUE; END IF;

    IF v_item.has_variants AND v_item.variant_id IS NOT NULL THEN
      SELECT v_item.quantity * COALESCE(weight_grams, 0) INTO v_add
        FROM public.menu_item_variants WHERE id = v_item.variant_id;
    ELSE
      v_add := v_item.quantity;
    END IF;

    IF COALESCE(v_add, 0) <= 0 THEN CONTINUE; END IF;

    UPDATE public.inventory
       SET stock = stock + v_add, updated_at = now()
     WHERE outlet_id = v_outlet AND menu_item_id = v_item.menu_item_id;
  END LOOP;

  UPDATE public.orders SET inventory_applied = false WHERE id = _order_id;
END;
$$;

-- 8. trigger on orders status transitions
CREATE OR REPLACE FUNCTION public.fn_orders_inventory_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- moving INTO an accepted/active status => apply
  IF NEW.status::text IN ('accepted','preparing','ready','ready_for_pickup','served','picked_up','out_for_delivery','delivered','closed')
     AND NOT COALESCE(NEW.inventory_applied, false)
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.fn_apply_inventory(NEW.id);
  END IF;

  -- moving to cancelled while applied => restore
  IF NEW.status::text = 'cancelled'
     AND COALESCE(OLD.inventory_applied, false)
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.fn_restore_inventory(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_inventory_sync ON public.orders;
CREATE TRIGGER trg_orders_inventory_sync
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_orders_inventory_sync();
