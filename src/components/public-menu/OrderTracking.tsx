import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Receipt, CheckCircle2, Clock, ChefHat, Bell, Truck, Upload, CreditCard, Banknote, ArrowRight, ShoppingBag, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getStatusLabel, getTrackingStatusesForOrderType, isCustomerTrackableStatus } from '@/lib/orderStatusConstants';
import CancelOrderDialog from '@/components/public-menu/CancelOrderDialog';

// Customer-facing bill: summary only, no print receipt — outlet handles printing.

const stepLabels: Record<string, string> = {
  pending: 'Order Placed',
};
const stepIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4" />, accepted: <CheckCircle2 className="h-4 w-4" />,
  preparing: <ChefHat className="h-4 w-4" />, ready: <Bell className="h-4 w-4" />,
  ready_for_pickup: <ShoppingBag className="h-4 w-4" />, served: <CheckCircle2 className="h-4 w-4" />,
  out_for_delivery: <Truck className="h-4 w-4" />, delivered: <CheckCircle2 className="h-4 w-4" />,
  picked_up: <CheckCircle2 className="h-4 w-4" />,
};

interface OutletInfo {
  name: string;
  address?: string | null;
  phone?: string | null;
  city?: string | null;
}

interface OrderTrackingProps {
  orderIds: string[];
  outletName: string;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  outletSettings?: {
    tax_rate?: number | null; service_charge_rate?: number | null;
  } | null;
  paymentInfo?: {
    bank_name?: string | null;
    bank_account_title?: string | null;
    bank_account_number?: string | null;
    bank_iban?: string | null;
    jazzcash_title?: string | null;
    jazzcash_number?: string | null;
    easypaisa_title?: string | null;
    easypaisa_number?: string | null;
  } | null;
  outletId: string;
  onOrderMore: () => void;
  outletInfo?: OutletInfo | null;
  tableNumber?: string | null;
  onAllClosed?: () => void;
}

interface RoundData {
  id: string;
  status: string;
  total: number;
  subtotal: number;
  tax_amount: number;
  service_charge: number;
  delivery_charge: number;
  payment_status: string;
  created_at?: string;
  order_items: { id: string; name: string; quantity: number; price: number; special_instructions?: string }[];
  payments?: { id: string; method: string | null; status: string; cash_handling_mode?: string | null }[];
}

function formatPaymentMethodLabel(
  method?: string | null,
  cashMode?: string | null,
  orderType?: 'dine_in' | 'takeaway' | 'delivery'
): string | null {
  if (!method) return null;
  if (method === 'cash') {
    if (orderType === 'delivery') return 'Cash on Delivery';
    if (cashMode === 'counter') return 'Cash (At Counter)';
    if (cashMode === 'waiter') return 'Cash (Via Waiter)';
    return 'Cash';
  }
  if (method === 'bank_transfer') return 'Bank Transfer';
  if (method === 'jazzcash') return 'JazzCash';
  if (method === 'easypaisa') return 'EasyPaisa';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unable to read payment proof file'));
        return;
      }
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Unable to read payment proof file'));
    reader.readAsDataURL(file);
  });
}

export default function OrderTracking({ orderIds, outletName, orderType, outletSettings, paymentInfo, outletId, onOrderMore, outletInfo, tableNumber, onAllClosed }: OrderTrackingProps) {
  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [showBill, setShowBill] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online' | null>(null);
  const [onlineMethod, setOnlineMethod] = useState<'bank_transfer' | 'jazzcash' | 'easypaisa' | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [billRequested, setBillRequested] = useState(false);
  const [cashMode, setCashMode] = useState<'counter' | 'waiter' | null>(null);
  const [cashSubmitted, setCashSubmitted] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Auto-set cash mode for delivery orders
  useEffect(() => {
    if (paymentMethod === 'cash' && orderType === 'delivery' && !cashMode) {
      setCashMode('counter');
    }
  }, [paymentMethod, orderType, cashMode]);

  // When all rounds reach their customer-facing final status, notify parent to clear tracking.
  // Payment verification alone must not clear tracking.
  useEffect(() => {
    if (rounds.length === 0) return;
    const allClosed = rounds.every(r => !isCustomerTrackableStatus(orderType, r.status));
    if (allClosed && onAllClosed) {
      onAllClosed();
    }
  }, [rounds, orderType, onAllClosed]);

  useEffect(() => {
    if (orderIds.length === 0) return;
    const fetchAll = async () => {
      const { data } = await supabase.from('orders')
        .select('id, status, total, subtotal, tax_amount, service_charge, delivery_charge, payment_status, created_at, order_items(*), payments(id, method, status, cash_handling_mode)')
        .in('id', orderIds);
      if (data) {
        const sorted = orderIds.map(id => data.find(d => d.id === id)).filter(Boolean) as RoundData[];
        setRounds(sorted);
      }
    };
    fetchAll();
    const channels = orderIds.map((id) =>
      supabase.channel(`order-round-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, (payload) => {
          setRounds(prev => prev.map(r => r.id === id ? { ...r, ...payload.new } : r));
        }).subscribe()
    );
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [orderIds.join(',')]);

  const steps = getTrackingStatusesForOrderType(orderType);

  // Recalculate totals with outlet tax/service settings
  // Billing rules by order type:
  // Dine-in: tax + service, no delivery
  // Delivery: delivery only, no tax/service
  // Takeaway: nothing extra
  const taxPct = orderType === 'dine_in' ? (outletSettings?.tax_rate || 0) : 0;
  const servicePct = orderType === 'dine_in' ? (outletSettings?.service_charge_rate || 0) : 0;

  const rawSubtotal = rounds.reduce((s, r) => s + (r.subtotal || 0), 0);
  const calculatedTax = Math.round(rawSubtotal * taxPct / 100);
  const calculatedService = Math.round(rawSubtotal * servicePct / 100);
  const combinedDelivery = orderType === 'delivery' ? rounds.reduce((s, r) => s + (r.delivery_charge || 0), 0) : 0;
  const grandTotal = rawSubtotal + calculatedTax + calculatedService + combinedDelivery;
  const allItems = rounds.flatMap(r => r.order_items || []);
  const billDate = new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
  const billNo = `BILL-${orderIds[0].slice(0, 8).toUpperCase()}`;

  // Derive recorded payment method from any round's payments (latest first)
  const recordedPayment = (() => {
    for (const r of rounds) {
      const p = (r.payments || [])[0];
      if (p && p.method) return p;
    }
    return null;
  })();
  const recordedMethodLabel = recordedPayment
    ? formatPaymentMethodLabel(recordedPayment.method, recordedPayment.cash_handling_mode, orderType)
    : null;
  const currentSelectionLabel = paymentMethod === 'cash'
    ? formatPaymentMethodLabel('cash', cashMode, orderType)
    : paymentMethod === 'online' && onlineMethod
      ? formatPaymentMethodLabel(onlineMethod, null, orderType)
      : null;
  const displayPaymentMethod = recordedMethodLabel || currentSelectionLabel;

  const anyUnpaid = rounds.some(r => r.payment_status === 'unpaid' || r.payment_status === 'rejected');
  const anyPending = rounds.some(r => r.payment_status === 'pending_verification');
  const allPaid = rounds.every(r => r.payment_status === 'paid');
  const anyRejected = rounds.some(r => r.payment_status === 'rejected');

  const handleRequestBill = async () => {
    for (const id of orderIds) {
      await supabase.from('bill_requests').insert({ order_id: id, status: 'requested' });
    }
    setBillRequested(true);
    setShowBill(true);
    toast.success('Bill requested!');
  };

  const handleSubmitPayment = async () => {
    if (!paymentMethod) return;

    if (paymentMethod === 'cash') {
      if (!cashMode) {
        toast.error('Please choose how you want to pay cash');
        return;
      }
      setSubmitting(true);
      try {
        // Create a payment record for each order with cash_handling_mode
        for (const id of orderIds) {
          const order = rounds.find(r => r.id === id);
          const orderTotal = order ? (order.subtotal || 0) + (order.tax_amount || 0) + (order.service_charge || 0) + (order.delivery_charge || 0) : 0;
          await supabase.from('payments').insert({
            order_id: id,
            outlet_id: outletId,
            method: 'cash',
            amount: orderTotal || grandTotal / orderIds.length,
            status: 'unpaid',
            cash_handling_mode: cashMode,
          } as any);
        }
        setCashSubmitted(true);
        const modeLabel = cashMode === 'counter' ? 'counter' : 'waiter';
        toast.success(
          orderType === 'delivery'
            ? 'Cash on delivery selected. Pay when your order arrives.'
            : cashMode === 'counter'
              ? 'Please pay your bill at the counter.'
              : 'A waiter will bring your bill shortly.'
        );
        setPaymentMethod(null);
        setCashMode(null);
      } catch (err: any) {
        toast.error(err.message || 'Failed to submit cash payment request');
      }
      setSubmitting(false);
      return;
    }

    if (!onlineMethod) {
      toast.error('Please select an online payment method');
      return;
    }

    if (!transactionId.trim()) {
      toast.error('Please enter your transaction ID');
      return;
    }

    if (!proofFile) {
      toast.error('Please upload your payment proof');
      return;
    }

    setSubmitting(true);

    try {
      const proofBase64 = await fileToBase64(proofFile);

      // Call the Edge Function via direct fetch so we can distinguish
      // transport-level failures (function not deployed, network) from
      // business-logic failures returned in the JSON body.
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey =
        (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ||
        (import.meta.env.VITE_SUPABASE_ANON_KEY as string);

      let res: Response;
      try {
        res = await fetch(`${supabaseUrl}/functions/v1/submit-payment-proof`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            orderIds,
            outletId,
            method: onlineMethod,
            transactionId: transactionId.trim(),
            proofBase64,
            fileName: proofFile.name,
            contentType: proofFile.type || 'image/jpeg',
          }),
        });
      } catch (networkErr: any) {
        throw new Error(
          'Could not reach payment service. Please check your connection and try again.'
        );
      }

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // ignore JSON parse error – handled below
      }

      if (res.status === 404) {
        throw new Error(
          'Payment service is not available right now. Please contact the outlet.'
        );
      }
      if (!res.ok) {
        throw new Error(data?.error || `Payment submission failed (${res.status})`);
      }
      if (data && data.ok === false) {
        throw new Error(data.error || 'Payment submission failed');
      }

      setRounds((prev) => prev.map((round) => ({ ...round, payment_status: 'pending_verification' })));
      toast.success('Payment proof submitted successfully. Your payment is pending verification.');
      setPaymentMethod(null);
      setOnlineMethod(null);
      setTransactionId('');
      setProofFile(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit payment proof');
    }

    setSubmitting(false);
  };

  // Customer-side print removed by design — outlet handles receipt printing.

  if (rounds.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-background max-w-lg mx-auto pb-8">
      {/* Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/30 to-background" />
        <div className="relative px-4 py-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3 ring-4 ring-primary/5">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            {rounds.length > 1 ? 'Your Orders' : 'Order Confirmed!'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{outletName}</p>
          {tableNumber && <p className="text-xs text-muted-foreground/70 mt-0.5">Table {tableNumber}</p>}
          {rounds.length > 1 && (
            <p className="text-xs text-muted-foreground/70 mt-1">{rounds.length} rounds ordered</p>
          )}
        </div>
      </div>

      {/* Per-Round Status */}
      <div className="px-4 py-4 space-y-4">
        {rounds.map((round, roundIdx) => {
          const currentIndex = round.status === 'closed'
            ? steps.length - 1
            : Math.max(steps.indexOf(round.status as any), 0);
          return (
            <div key={round.id} className="bg-card border rounded-2xl overflow-hidden shadow-card">
              <div className="bg-muted/50 px-4 py-2.5 border-b flex items-center justify-between">
                <h3 className="font-heading font-bold text-sm text-foreground">
                  {rounds.length > 1 ? `Round ${roundIdx + 1}` : '📍 Order Status'}
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground">#{round.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="px-4 pt-3 pb-1 space-y-1">
                {round.order_items?.map((item: any) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.quantity}× {item.name}</span>
                    <span className="text-muted-foreground">Rs.{(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center gap-1">
                  {steps.map((step, idx) => {
                    const isActive = idx <= currentIndex;
                    const isCurrent = idx === currentIndex;
                    return (
                      <div key={step} className="flex items-center flex-1">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all text-[10px] ${
                          isCurrent ? 'bg-primary text-primary-foreground ring-2 ring-primary/20 scale-110' : isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {stepIcons[step]}
                        </div>
                        {idx < steps.length - 1 && (
                          <div className={`flex-1 h-0.5 mx-0.5 ${isActive ? 'bg-primary' : 'bg-border'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs font-semibold text-primary mt-2 text-center">{stepLabels[round.status] || getStatusLabel(round.status)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Request Bill */}
      {!showBill && orderType === 'dine_in' && !billRequested && (
        <div className="px-4 pb-4">
          <Button onClick={handleRequestBill} className="w-full rounded-2xl py-5 gap-2 text-sm font-bold" variant="outline">
            <Receipt className="h-5 w-5" /> Request Bill
          </Button>
        </div>
      )}

      {/* Combined Bill Summary */}
      {(showBill || orderType !== 'dine_in') && (
        <div className="px-4 pb-6 space-y-4">
          {/* Professional Bill Card */}
          <div className="bg-card border rounded-2xl overflow-hidden shadow-card">
            <div className="bg-muted/50 px-4 py-3 border-b">
              <h3 className="font-heading font-bold text-sm text-foreground flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" /> Bill Summary
              </h3>
            </div>
            <div className="p-4 space-y-2">
              {/* Bill info */}
              <div className="flex justify-between text-[11px] text-muted-foreground mb-2">
                <span>{billNo}</span>
                <span>{billDate}</span>
              </div>
              {tableNumber && (
                <p className="text-[11px] text-muted-foreground mb-2">Table: {tableNumber}</p>
              )}

              {rounds.map((round, roundIdx) => (
                <div key={round.id}>
                  {rounds.length > 1 && (
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-2 mb-1">
                      Round {roundIdx + 1}
                    </p>
                  )}
                  {round.order_items?.map((item: any) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-foreground">{item.quantity}× {item.name}</span>
                      <span className="font-medium text-foreground">Rs.{(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="border-t pt-3 mt-3 space-y-1.5">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span><span>Rs.{rawSubtotal.toLocaleString()}</span>
                </div>
                {taxPct > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Tax ({taxPct}%)</span><span>Rs.{calculatedTax.toLocaleString()}</span>
                  </div>
                )}
                {servicePct > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Service Charge ({servicePct}%)</span><span>Rs.{calculatedService.toLocaleString()}</span>
                  </div>
                )}
                {combinedDelivery > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Delivery Charges</span><span>Rs.{combinedDelivery.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between font-heading font-extrabold text-base text-foreground pt-2 border-t">
                  <span>Grand Total</span><span>Rs.{grandTotal.toLocaleString()}</span>
                </div>
                {displayPaymentMethod && (
                  <div className="flex justify-between text-xs text-muted-foreground pt-1.5 border-t border-dashed">
                    <span>Payment Method</span>
                    <span className="font-semibold text-foreground">{displayPaymentMethod}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Payment Methods */}
          {anyUnpaid && !allPaid && !anyPending && (
            <div className="space-y-3">
              <h3 className="font-heading font-bold text-sm text-foreground">💳 Payment Method</h3>

              {/* Step 1: Cash vs Online */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setPaymentMethod('cash'); setOnlineMethod(null); }}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${paymentMethod === 'cash' ? 'border-primary bg-primary/5 shadow-md' : 'border-border hover:border-primary/30'}`}
                >
                  <Banknote className={`h-7 w-7 ${paymentMethod === 'cash' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs font-semibold text-foreground">{orderType === 'delivery' ? 'Cash on Delivery' : 'Pay Cash'}</span>
                </button>
                <button
                  onClick={() => { setPaymentMethod('online'); setOnlineMethod(null); }}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${paymentMethod === 'online' ? 'border-primary bg-primary/5 shadow-md' : 'border-border hover:border-primary/30'}`}
                >
                  <CreditCard className={`h-7 w-7 ${paymentMethod === 'online' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs font-semibold text-foreground">Online Payment</span>
                </button>
              </div>

              {/* Step 2: Online → Select Specific Method */}
              {paymentMethod === 'online' && paymentInfo && (() => {
                const hasBank = !!(paymentInfo.bank_account_title || paymentInfo.bank_account_number || paymentInfo.bank_name);
                const hasJazz = !!paymentInfo.jazzcash_number;
                const hasEasy = !!paymentInfo.easypaisa_number;
                const hasAny = hasBank || hasJazz || hasEasy;

                if (!hasAny) {
                  return (
                    <div className="bg-destructive/10 rounded-2xl p-4 text-center border border-destructive/20">
                      <p className="text-sm font-semibold text-destructive">No online payment methods configured</p>
                      <p className="text-xs text-muted-foreground mt-1">Please contact the outlet or pay with cash</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground font-medium">Select payment method:</p>
                    <div className="grid gap-2">
                      {hasBank && (
                        <button
                          onClick={() => setOnlineMethod('bank_transfer')}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${onlineMethod === 'bank_transfer' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                        >
                          <span className="text-lg">🏦</span>
                          <span className="text-sm font-semibold text-foreground">Bank Transfer</span>
                        </button>
                      )}
                      {hasEasy && (
                        <button
                          onClick={() => setOnlineMethod('easypaisa')}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${onlineMethod === 'easypaisa' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                        >
                          <span className="text-lg">📱</span>
                          <span className="text-sm font-semibold text-foreground">EasyPaisa</span>
                        </button>
                      )}
                      {hasJazz && (
                        <button
                          onClick={() => setOnlineMethod('jazzcash')}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${onlineMethod === 'jazzcash' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                        >
                          <span className="text-lg">📲</span>
                          <span className="text-sm font-semibold text-foreground">JazzCash</span>
                        </button>
                      )}
                    </div>

                    {/* Step 3: Show details for selected method */}
                    {onlineMethod && (
                      <div className="bg-card border rounded-2xl p-4 space-y-3">
                        <h4 className="font-heading font-bold text-sm text-foreground">
                          {onlineMethod === 'bank_transfer' ? '🏦 Bank Transfer Details' :
                           onlineMethod === 'easypaisa' ? '📱 EasyPaisa Details' : '📲 JazzCash Details'}
                        </h4>

                        {onlineMethod === 'bank_transfer' && (
                          <div className="bg-muted/50 rounded-xl p-3 space-y-2">
                            {paymentInfo.bank_name && (
                              <div>
                                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Bank Name</p>
                                <p className="text-sm font-medium text-foreground">{paymentInfo.bank_name}</p>
                              </div>
                            )}
                            {paymentInfo.bank_account_title && (
                              <div>
                                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Account Title</p>
                                <p className="text-sm font-medium text-foreground">{paymentInfo.bank_account_title}</p>
                              </div>
                            )}
                            {paymentInfo.bank_account_number && (
                              <div>
                                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Account Number</p>
                                <p className="text-sm font-medium text-foreground font-mono">{paymentInfo.bank_account_number}</p>
                              </div>
                            )}
                            {paymentInfo.bank_iban && (
                              <div>
                                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">IBAN</p>
                                <p className="text-sm font-medium text-foreground font-mono">{paymentInfo.bank_iban}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {onlineMethod === 'easypaisa' && (
                          <div className="bg-muted/50 rounded-xl p-3 space-y-2">
                            {(paymentInfo.easypaisa_title) && (
                              <div>
                                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Account Title</p>
                                <p className="text-sm font-medium text-foreground">{paymentInfo.easypaisa_title}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">EasyPaisa Number</p>
                              <p className="text-sm font-medium text-foreground font-mono">{paymentInfo.easypaisa_number}</p>
                            </div>
                          </div>
                        )}
                        {onlineMethod === 'jazzcash' && (
                          <div className="bg-muted/50 rounded-xl p-3 space-y-2">
                            {(paymentInfo.jazzcash_title) && (
                              <div>
                                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Account Title</p>
                                <p className="text-sm font-medium text-foreground">{paymentInfo.jazzcash_title}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">JazzCash Number</p>
                              <p className="text-sm font-medium text-foreground font-mono">{paymentInfo.jazzcash_number}</p>
                            </div>
                          </div>
                        )}

                        <div className="bg-accent/30 rounded-xl p-3 text-center">
                          <p className="text-xs font-semibold text-foreground">Amount to Pay</p>
                          <p className="text-lg font-extrabold text-primary">Rs.{grandTotal.toLocaleString()}</p>
                        </div>

                        {/* Step 4: Proof submission form */}
                        <div className="border-t pt-3 space-y-2.5">
                          <p className="text-xs font-semibold text-foreground">📤 Submit Payment Proof</p>
                          <Input placeholder="Transaction ID / Reference Number *" value={transactionId} onChange={e => setTransactionId(e.target.value)} className="rounded-xl h-11" />
                          <label className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed border-border cursor-pointer hover:border-primary/50 transition-colors">
                            <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
                            <span className="text-sm text-muted-foreground truncate">{proofFile ? proofFile.name : 'Upload Payment Screenshot'}</span>
                            <input type="file" accept="image/*" className="hidden" onChange={e => setProofFile(e.target.files?.[0] || null)} />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Submit buttons */}
              {paymentMethod === 'cash' && !cashSubmitted && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground font-medium">
                    {orderType === 'delivery' ? 'Confirm cash on delivery:' : 'How would you like to pay?'}
                  </p>
                  {orderType !== 'delivery' && (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setCashMode('counter')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${cashMode === 'counter' ? 'border-primary bg-primary/5 shadow-md' : 'border-border hover:border-primary/30'}`}
                      >
                        <span className="text-2xl">🏪</span>
                        <span className="text-xs font-semibold text-foreground">Pay at Counter</span>
                      </button>
                      <button
                        onClick={() => setCashMode('waiter')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${cashMode === 'waiter' ? 'border-primary bg-primary/5 shadow-md' : 'border-border hover:border-primary/30'}`}
                      >
                        <span className="text-2xl">🧑‍🍳</span>
                        <span className="text-xs font-semibold text-foreground">Ask Waiter to Bring Bill</span>
                      </button>
                    </div>
                  )}
                  
                  <Button
                    onClick={handleSubmitPayment}
                    disabled={submitting || (!cashMode && orderType !== 'delivery')}
                    className="w-full rounded-2xl py-5 font-bold gap-2"
                  >
                    {submitting ? 'Submitting...' : orderType === 'delivery' ? 'Confirm Cash on Delivery' : `Confirm ${cashMode === 'counter' ? 'Counter' : cashMode === 'waiter' ? 'Waiter' : 'Cash'} Payment`}
                    {!submitting && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </div>
              )}
              {cashSubmitted && (
                <div className="bg-primary/10 rounded-2xl p-4 text-center border border-primary/20 space-y-1">
                  <p className="text-sm font-semibold text-primary">
                    {orderType === 'delivery' ? '🛵 Cash on Delivery' : cashMode === 'waiter' ? '🧑‍🍳 Waiter will bring your bill shortly' : '🏪 Please pay at the counter'}
                  </p>
                  <p className="text-xs text-muted-foreground">Your payment is pending confirmation by staff.</p>
                </div>
              )}
              {paymentMethod === 'online' && onlineMethod && (
                <Button onClick={handleSubmitPayment} disabled={submitting || !transactionId.trim() || !proofFile} className="w-full rounded-2xl py-5 font-bold gap-2">
                  {submitting ? 'Submitting...' : 'Submit Payment Proof'}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </Button>
              )}
            </div>
          )}

          {anyRejected && !anyPending && !allPaid && (
            <div className="bg-destructive/10 rounded-2xl p-4 text-center border border-destructive/20 space-y-2">
              <p className="text-sm font-semibold text-destructive">❌ Payment was rejected by the outlet</p>
              <p className="text-xs text-muted-foreground">Please resubmit with correct payment proof</p>
            </div>
          )}
          {anyPending && (
            <div className="bg-secondary/10 rounded-2xl p-4 text-center border border-secondary/20">
              <p className="text-sm font-semibold text-secondary">⏳ Payment Proof Submitted Successfully</p>
              <p className="text-xs text-muted-foreground mt-1">Your payment is pending verification. We will verify it shortly.</p>
            </div>
          )}
          {allPaid && (
            <div className="bg-primary/10 rounded-2xl p-4 text-center border border-primary/20">
              <p className="text-sm font-semibold text-primary">✅ Payment verified!</p>
            </div>
          )}
        </div>
      )}

      {/* Order More + Cancel */}
      <div className="px-4 pb-8 space-y-3">
        <Button variant="outline" className="w-full rounded-2xl py-5 gap-2 font-bold" onClick={onOrderMore}>
          <ShoppingBag className="h-4 w-4" /> Order More
        </Button>
        {(() => {
          const cancellable = rounds.length > 0
            && rounds.every(r => (r.status === 'pending' || r.status === 'accepted') && r.payment_status !== 'paid');
          if (!cancellable) return null;
          return (
            <Button
              variant="ghost"
              className="w-full rounded-2xl py-4 gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setCancelOpen(true)}
            >
              <XCircle className="h-4 w-4" /> Cancel Order
            </Button>
          );
        })()}
      </div>

      <CancelOrderDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        orderIds={orderIds}
        onCancelled={() => {
          setRounds(prev => prev.map(r => ({ ...r, status: 'cancelled' })));
          if (onAllClosed) onAllClosed();
        }}
      />

    </div>
  );
}
