import { useMemo, useState } from 'react';
import { useOutlet, useMenuCategories, useMenuItems } from '@/hooks/useData';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Minus, Trash2, Search, ShoppingCart, Printer, Loader2, Banknote, CreditCard, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

type CartItem = { id: string; name: string; price: number; quantity: number };

export default function POS() {
  const { data: outlet } = useOutlet();
  const settings = (outlet as any)?.outlet_settings?.[0];
  const currency = settings?.currency || 'PKR';
  const taxRate = Number(settings?.tax_rate) || 0;
  const serviceChargeRate = Number(settings?.service_charge_rate) || 0;

  const { data: categories } = useMenuCategories(outlet?.id);
  const { data: items, isLoading } = useMenuItems(outlet?.id);

  const [activeCat, setActiveCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'online'>('cash');
  const [paperSize, setPaperSize] = useState<'58mm' | '80mm'>('80mm');
  const [placing, setPlacing] = useState(false);

  const visibleItems = useMemo(() => {
    return (items ?? []).filter((i: any) => {
      if (!i.is_available) return false;
      if (activeCat !== 'all' && i.category_id !== activeCat) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, activeCat, search]);

  const itemPrice = (i: any) => Number(i.discounted_price ?? i.price);

  const addToCart = (i: any) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === i.id);
      if (existing) return prev.map(c => c.id === i.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { id: i.id, name: i.name, price: itemPrice(i), quantity: 1 }];
    });
  };
  const decrement = (id: string) => setCart(prev => prev.flatMap(c => c.id === id ? (c.quantity <= 1 ? [] : [{ ...c, quantity: c.quantity - 1 }]) : [c]));
  const increment = (id: string) => setCart(prev => prev.map(c => c.id === id ? { ...c, quantity: c.quantity + 1 } : c));
  const remove = (id: string) => setCart(prev => prev.filter(c => c.id !== id));

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const discountAmount = (() => {
    const v = Number(discountValue) || 0;
    if (v <= 0) return 0;
    if (discountType === 'percent') return Math.min(subtotal, (subtotal * v) / 100);
    return Math.min(subtotal, v);
  })();
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const serviceCharge = (afterDiscount * serviceChargeRate) / 100;
  const tax = ((afterDiscount + serviceCharge) * taxRate) / 100;
  const total = afterDiscount + serviceCharge + tax;

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  const printReceipt = (orderNumber: string) => {
    const w = window.open('', 'PRINT', 'height=600,width=400');
    if (!w) { toast.error('Popup blocked. Allow popups to print.'); return; }
    const widthMm = paperSize === '58mm' ? '58mm' : '80mm';
    const innerWidth = paperSize === '58mm' ? '54mm' : '76mm';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${orderNumber}</title>
<style>
@page { size: ${widthMm} auto; margin: 2mm; }
* { box-sizing: border-box; }
body { font-family: 'Courier New', monospace; width: ${innerWidth}; margin: 0 auto; color: #000; font-size: ${paperSize === '58mm' ? '10px' : '12px'}; }
.center { text-align: center; }
.right { text-align: right; }
.bold { font-weight: bold; }
hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 1px 0; vertical-align: top; }
.qty { width: 22px; }
.amt { text-align: right; white-space: nowrap; }
h2 { margin: 0; font-size: ${paperSize === '58mm' ? '14px' : '16px'}; }
.small { font-size: ${paperSize === '58mm' ? '9px' : '10px'}; }
</style></head><body>
<div class="center">
  ${outlet?.logo_url ? `<img src="${outlet.logo_url}" alt="" style="max-width:50px;max-height:50px;margin-bottom:4px;" />` : ''}
  <h2>${outlet?.name ?? ''}</h2>
  <div class="small">${outlet?.address ?? ''}</div>
  <div class="small">${outlet?.phone ?? ''}</div>
</div>
<hr/>
<div class="small">
  <div>Order #: <span class="bold">${orderNumber}</span></div>
  <div>Date: ${new Date().toLocaleString()}</div>
  <div>Payment: ${paymentMethod.toUpperCase()}</div>
</div>
<hr/>
<table>
  <thead><tr><td class="qty bold">Qty</td><td class="bold">Item</td><td class="amt bold">Amount</td></tr></thead>
  <tbody>
  ${cart.map(c => `<tr><td class="qty">${c.quantity}</td><td>${c.name}</td><td class="amt">${(c.price * c.quantity).toFixed(2)}</td></tr>`).join('')}
  </tbody>
</table>
<hr/>
<table class="small">
  <tr><td>Subtotal</td><td class="amt">${subtotal.toFixed(2)}</td></tr>
  ${discountAmount > 0 ? `<tr><td>Discount</td><td class="amt">-${discountAmount.toFixed(2)}</td></tr>` : ''}
  ${serviceCharge > 0 ? `<tr><td>Service (${serviceChargeRate}%)</td><td class="amt">${serviceCharge.toFixed(2)}</td></tr>` : ''}
  ${tax > 0 ? `<tr><td>Tax (${taxRate}%)</td><td class="amt">${tax.toFixed(2)}</td></tr>` : ''}
</table>
<hr/>
<table>
  <tr class="bold" style="font-size:${paperSize === '58mm' ? '12px' : '14px'};">
    <td>TOTAL</td><td class="amt">${currency} ${total.toFixed(2)}</td>
  </tr>
</table>
<hr/>
<div class="center small">Thank you!</div>
<script>window.onload = function(){ window.focus(); window.print(); setTimeout(function(){ window.close(); }, 500); };<\/script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  };

  const checkout = async (printAfter: boolean) => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!outlet?.id) return;
    setPlacing(true);
    try {
      const paymentMethodEnum = paymentMethod === 'card' ? 'cash' : (paymentMethod === 'online' ? 'easypaisa' : 'cash');
      const { data: order, error } = await supabase.from('orders').insert({
        outlet_id: outlet.id,
        order_type: 'takeaway',
        subtotal,
        tax_amount: Math.round(tax),
        service_charge: Math.round(serviceCharge),
        delivery_charge: 0,
        total: Math.round(total),
        status: 'completed',
        payment_status: 'paid',
        payment_method: paymentMethodEnum as any,
        special_instructions: discountAmount > 0 ? `POS · Discount ${discountType === 'percent' ? discountValue + '%' : currency + ' ' + discountAmount.toFixed(2)}` : 'POS sale',
        customer_name: 'Walk-in',
        session_id: 'pos-' + Date.now(),
      } as any).select().single();
      if (error) throw error;

      const orderItemsPayload = cart.map(c => ({
        order_id: order.id, menu_item_id: c.id, name: c.name, quantity: c.quantity, price: c.price,
      }));
      await supabase.from('order_items').insert(orderItemsPayload);

      await supabase.from('payments').insert({
        order_id: order.id, outlet_id: outlet.id,
        amount: Math.round(total), method: paymentMethodEnum as any, status: 'paid',
        amount_received: Math.round(total), change_returned: 0,
      } as any);

      const orderNumber = order.id.slice(-6).toUpperCase();
      toast.success(`Sale complete · ${orderNumber}`);
      if (printAfter) printReceipt(orderNumber);
      setCart([]);
      setDiscountValue('');
    } catch (err: any) {
      toast.error(err.message || 'Checkout failed');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="space-y-4 -m-4 md:-m-6 lg:-m-8 p-4 md:p-6 lg:p-8 min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground">POS Lite</h1>
          <p className="text-muted-foreground text-sm">Quick billing for counter sales</p>
        </div>
        <Badge variant="outline" className="text-xs">{currency} · Tax {taxRate}% · Service {serviceChargeRate}%</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* LEFT: Catalog */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-12 text-base" />
            </div>
          </div>

          <ScrollArea className="w-full">
            <div className="flex gap-2 pb-2">
              <Button size="lg" variant={activeCat === 'all' ? 'default' : 'outline'} onClick={() => setActiveCat('all')} className="shrink-0">All</Button>
              {(categories ?? []).map((c: any) => (
                <Button key={c.id} size="lg" variant={activeCat === c.id ? 'default' : 'outline'} onClick={() => setActiveCat(c.id)} className="shrink-0">{c.name}</Button>
              ))}
            </div>
          </ScrollArea>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : visibleItems.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No items found.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleItems.map((i: any) => (
                <button
                  key={i.id}
                  onClick={() => addToCart(i)}
                  className="group relative flex flex-col items-stretch text-left rounded-xl border bg-card hover:bg-accent hover:border-primary transition-colors overflow-hidden active:scale-[0.98]"
                >
                  {i.image_url && (
                    <div className="aspect-square w-full overflow-hidden bg-muted">
                      <img src={i.image_url} alt={i.name} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className="p-3 flex flex-col gap-1">
                    <p className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{i.name}</p>
                    <p className="text-base font-bold text-primary">{currency} {itemPrice(i).toFixed(0)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Cart */}
        <Card className="lg:sticky lg:top-20 self-start max-h-[calc(100vh-6rem)] flex flex-col">
          <div className="p-4 border-b flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Cart ({cart.reduce((s, c) => s + c.quantity, 0)})</h2>
            {cart.length > 0 && (
              <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setCart([])}>Clear</Button>
            )}
          </div>

          <ScrollArea className="flex-1 max-h-[40vh]">
            <div className="p-4 space-y-2">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Tap items to add</p>
              ) : cart.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{currency} {c.price.toFixed(0)} × {c.quantity} = <span className="font-semibold text-foreground">{currency} {(c.price * c.quantity).toFixed(0)}</span></p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => decrement(c.id)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center text-sm font-bold">{c.quantity}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => increment(c.id)}><Plus className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="p-4 border-t space-y-3 bg-muted/30">
            <div className="grid grid-cols-[1fr_2fr] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Discount</Label>
                <Select value={discountType} onValueChange={v => setDiscountType(v as any)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">{currency}</SelectItem>
                    <SelectItem value="percent">%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Value</Label>
                <Input type="number" inputMode="decimal" value={discountValue} onChange={e => setDiscountValue(e.target.value)} placeholder="0" className="h-9" />
              </div>
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(subtotal)}</span></div>
              {discountAmount > 0 && <div className="flex justify-between text-destructive"><span>Discount</span><span>-{fmt(discountAmount)}</span></div>}
              {serviceCharge > 0 && <div className="flex justify-between text-muted-foreground"><span>Service ({serviceChargeRate}%)</span><span>{fmt(serviceCharge)}</span></div>}
              {tax > 0 && <div className="flex justify-between text-muted-foreground"><span>Tax ({taxRate}%)</span><span>{fmt(tax)}</span></div>}
              <div className="flex justify-between text-lg font-bold pt-1 border-t mt-1"><span>TOTAL</span><span className="text-primary">{fmt(total)}</span></div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant={paymentMethod === 'cash' ? 'default' : 'outline'} onClick={() => setPaymentMethod('cash')} className="flex-col h-auto py-2"><Banknote className="h-4 w-4 mb-1" /><span className="text-xs">Cash</span></Button>
              <Button variant={paymentMethod === 'card' ? 'default' : 'outline'} onClick={() => setPaymentMethod('card')} className="flex-col h-auto py-2"><CreditCard className="h-4 w-4 mb-1" /><span className="text-xs">Card</span></Button>
              <Button variant={paymentMethod === 'online' ? 'default' : 'outline'} onClick={() => setPaymentMethod('online')} className="flex-col h-auto py-2"><Smartphone className="h-4 w-4 mb-1" /><span className="text-xs">Online</span></Button>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Receipt size</Label>
              <Select value={paperSize} onValueChange={v => setPaperSize(v as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58mm</SelectItem>
                  <SelectItem value="80mm">80mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant="outline" disabled={placing || cart.length === 0} onClick={() => checkout(false)}>
                {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Charge'}
              </Button>
              <Button size="lg" disabled={placing || cart.length === 0} onClick={() => checkout(true)}>
                <Printer className="h-4 w-4 mr-1" />Charge & Print
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}