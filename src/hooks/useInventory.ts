import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface InventoryRow {
  id: string;
  outlet_id: string;
  menu_item_id: string;
  stock: number;
  low_threshold: number;
  critical_threshold: number;
  updated_at: string;
}

export function useInventory(outletId?: string) {
  return useQuery({
    queryKey: ['inventory', outletId],
    enabled: !!outletId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('inventory')
        .select('*')
        .eq('outlet_id', outletId!);
      if (error) throw error;
      return (data || []) as InventoryRow[];
    },
  });
}

export function useUpdateInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      stock?: number;
      low_threshold?: number;
      critical_threshold?: number;
    }) => {
      const { id, ...updates } = params;
      const { error } = await (supabase as any).from('inventory').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export interface MenuItemVariant {
  id: string;
  menu_item_id: string;
  label: string;
  price: number;
  weight_grams: number;
  sort_order: number;
}

export function useMenuItemVariants(outletId?: string) {
  return useQuery({
    queryKey: ['menu_item_variants', outletId],
    enabled: !!outletId,
    queryFn: async () => {
      if (!outletId) return [] as MenuItemVariant[];
      const { data: items } = await supabase.from('menu_items').select('id').eq('outlet_id', outletId);
      const ids = (items || []).map((i: any) => i.id);
      if (ids.length === 0) return [] as MenuItemVariant[];
      const { data, error } = await (supabase as any)
        .from('menu_item_variants')
        .select('*')
        .in('menu_item_id', ids)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as MenuItemVariant[];
    },
  });
}

export function useReplaceVariants() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { menu_item_id: string; variants: Array<{ label: string; price: number; weight_grams: number }> }) => {
      const { menu_item_id, variants } = params;
      const sb: any = supabase;
      await sb.from('menu_item_variants').delete().eq('menu_item_id', menu_item_id);
      if (variants.length > 0) {
        const rows = variants.map((v, idx) => ({
          menu_item_id,
          label: v.label,
          price: Number(v.price) || 0,
          weight_grams: Number(v.weight_grams) || 0,
          sort_order: idx,
        }));
        const { error } = await sb.from('menu_item_variants').insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu_item_variants'] });
      qc.invalidateQueries({ queryKey: ['public_menu'] });
    },
  });
}

export function getStockColor(stock: number): string {
  if (stock <= 5) return 'text-destructive';
  if (stock <= 10) return 'text-pink-500';
  return 'text-emerald-600';
}