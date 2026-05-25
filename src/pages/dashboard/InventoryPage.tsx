import { useMemo, useState, useEffect } from 'react';
import { useOutlet, useMenuCategories, useMenuItems } from '@/hooks/useData';
import { useInventory, useUpdateInventory, useMenuItemVariants, getStockColor } from '@/hooks/useInventory';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Minus, Save, Package, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RowState { stock: string; low: string; critical: string; dirty: boolean }

export default function InventoryPage() {
  const { data: outlet } = useOutlet();
  const { data: items } = useMenuItems(outlet?.id);
  const { data: categories } = useMenuCategories(outlet?.id);
  const { data: inventory } = useInventory(outlet?.id);
  const { data: variants } = useMenuItemVariants(outlet?.id);
  const updateInv = useUpdateInventory();

  const [rows, setRows] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (!inventory) return;
    setRows(prev => {
      const next: Record<string, RowState> = { ...prev };
      for (const inv of inventory) {
        if (!next[inv.id] || !next[inv.id].dirty) {
          next[inv.id] = {
            stock: String(inv.stock),
            low: String(inv.low_threshold),
            critical: String(inv.critical_threshold),
            dirty: false,
          };
        }
      }
      return next;
    });
  }, [inventory]);

  const invByItem = useMemo(() => {
    const m = new Map<string, typeof inventory extends Array<infer T> ? T : any>();
    (inventory || []).forEach(i => m.set(i.menu_item_id, i));
    return m;
  }, [inventory]);

  const variantsByItem = useMemo(() => {
    const m = new Map<string, any[]>();
    (variants || []).forEach(v => {
      if (!m.has(v.menu_item_id)) m.set(v.menu_item_id, []);
      m.get(v.menu_item_id)!.push(v);
    });
    return m;
  }, [variants]);

  const trackedItems = (items || []).filter((i: any) => i.track_inventory);

  const setField = (id: string, field: keyof RowState, value: string) => {
    setRows(r => ({ ...r, [id]: { ...r[id], [field]: value, dirty: true } as RowState }));
  };

  const adjust = (id: string, delta: number) => {
    setRows(r => {
      const cur = r[id] || { stock: '0', low: '10', critical: '5', dirty: false };
      const newVal = Math.max(0, (Number(cur.stock) || 0) + delta);
      return { ...r, [id]: { ...cur, stock: String(newVal), dirty: true } };
    });
  };

  const save = async (id: string) => {
    const r = rows[id];
    if (!r) return;
    try {
      await updateInv.mutateAsync({
        id,
        stock: Number(r.stock) || 0,
        low_threshold: Number(r.low) || 0,
        critical_threshold: Number(r.critical) || 0,
      });
      setRows(s => ({ ...s, [id]: { ...s[id], dirty: false } }));
      toast.success('Stock updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update');
    }
  };

  if (!outlet) return <p className="text-muted-foreground">Please set up your outlet first.</p>;

  const grouped = (categories || []).map(c => ({
    cat: c,
    items: trackedItems.filter((i: any) => i.category_id === c.id),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-6 w-6" /> Inventory
          </h1>
          <p className="text-muted-foreground text-sm">
            Track stock for menu items. Enable "Track inventory" on each menu item to start tracking.
          </p>
        </div>
      </div>

      <Card className="bg-muted/40 border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>Stock colors:</span>
          <span className="font-bold text-emerald-600">Green = healthy ({'>'}10)</span>
          <span className="font-bold text-pink-500">Pink = low (≤10)</span>
          <span className="font-bold text-destructive">Red = critical (≤5)</span>
        </CardContent>
      </Card>

      {trackedItems.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No tracked items yet. Open <strong>Menu</strong>, edit an item, and turn on "Track inventory".
          </CardContent>
        </Card>
      )}

      {grouped.map(g => (
        <div key={g.cat.id} className="space-y-2">
          <h3 className="font-heading font-semibold text-foreground">{g.cat.name}</h3>
          <div className="space-y-2">
            {g.items.map((item: any) => {
              const inv = invByItem.get(item.id);
              if (!inv) return null;
              const r = rows[inv.id] || { stock: String(inv.stock), low: String(inv.low_threshold), critical: String(inv.critical_threshold), dirty: false };
              const stockNum = Number(r.stock) || 0;
              const unit = item.unit_type === 'kg' ? 'g' : 'qty';
              const itemVariants = variantsByItem.get(item.id) || [];
              return (
                <Card key={item.id} className="shadow-card">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="secondary" className="text-xs">{item.unit_type === 'kg' ? 'Weight (g)' : 'Quantity'}</Badge>
                          {item.has_variants && <Badge variant="outline" className="text-xs">Sized item</Badge>}
                        </div>
                      </div>
                      <div className={cn('font-heading text-3xl font-extrabold', getStockColor(stockNum))}>
                        {stockNum}<span className="text-xs font-medium ml-1 opacity-70">{unit}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                      <div className="sm:col-span-2">
                        <label className="text-xs text-muted-foreground">Stock</label>
                        <div className="flex gap-1 mt-1">
                          <Button type="button" size="icon" variant="outline" onClick={() => adjust(inv.id, -1)} aria-label="Decrease stock"><Minus className="h-4 w-4" /></Button>
                          <Input type="number" inputMode="numeric" value={r.stock} onChange={e => setField(inv.id, 'stock', e.target.value)} className="text-center" />
                          <Button type="button" size="icon" variant="outline" onClick={() => adjust(inv.id, 1)} aria-label="Increase stock"><Plus className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Low at</label>
                        <Input type="number" inputMode="numeric" value={r.low} onChange={e => setField(inv.id, 'low', e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Critical at</label>
                        <Input type="number" inputMode="numeric" value={r.critical} onChange={e => setField(inv.id, 'critical', e.target.value)} className="mt-1" />
                      </div>
                    </div>

                    {item.has_variants && itemVariants.length > 0 && (
                      <div className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground mb-1">Size deductions per order</p>
                        <ul className="space-y-0.5">
                          {itemVariants.map(v => (
                            <li key={v.id} className="flex justify-between">
                              <span>{v.label}</span>
                              <span className="font-medium">{v.weight_grams}g · Rs.{v.price}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Button size="sm" disabled={!r.dirty || updateInv.isPending} onClick={() => save(inv.id)}>
                        <Save className="h-4 w-4 mr-1" /> Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}