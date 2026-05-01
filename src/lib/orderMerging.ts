/**
 * Order merging rules (CORRECTED):
 *  - Merging is based on PAYMENT STATUS, not order workflow status.
 *  - An order belongs to the active merge group as long as it is UNPAID
 *    (payment_status !== 'paid'), regardless of whether it is served,
 *    delivered, picked up, or closed. The Combined Bill stays visible
 *    until the entire bill is paid.
 *  - Cancelled orders are ALWAYS excluded — they don't belong to any bill.
 *  - Once an order is fully PAID, it leaves the active merge group.
 *    Any new order from the same customer/table after that becomes a new bill.
 *
 * Grouping keys:
 *  - Dine-in: outlet + table_id + session_id (when present)
 *  - Delivery: outlet + customer_phone + calendar day
 *  - Takeaway: outlet + customer_phone + calendar day
 */

// Statuses that exclude an order from ANY merge group entirely.
// Only cancelled — paid orders are handled separately by payment_status.
export const FINAL_STATUSES = new Set(['cancelled']);

export function isFinalStatus(status?: string | null): boolean {
  return !!status && FINAL_STATUSES.has(status);
}

export function isPaid(paymentStatus?: string | null): boolean {
  return paymentStatus === 'paid';
}

/** An order is "active for billing" when it's not cancelled AND not fully paid. */
export function isActiveForBilling(order: { status?: string | null; payment_status?: string | null }): boolean {
  return !isFinalStatus(order.status) && !isPaid(order.payment_status);
}

export type MergeableOrder = {
  id: string;
  outlet_id?: string | null;
  order_type?: string | null;
  table_id?: string | null;
  session_id?: string | null;
  customer_phone?: string | null;
  status?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
};

export function getMergeKey(order: MergeableOrder): string | null {
  // Cancelled or already-paid orders don't belong to the active merge group.
  if (!isActiveForBilling(order)) return null;

  const ot = order.order_type || (order.table_id ? 'dine_in' : 'delivery');

  if (ot === 'dine_in') {
    if (!order.table_id) return null;
    // Strict per-visitor merge: a new customer at the same table gets a new
    // session_id (set client-side per visit), so they never merge into the
    // previous customer's bill. Legacy rows without session_id fall back to
    // their own id so they never merge with anything else.
    const sid = order.session_id || `__noSession__${order.id}`;
    return `dine|${order.outlet_id || ''}|${order.table_id}|${sid}`;
  }

  if (ot === 'delivery' || ot === 'takeaway') {
    if (!order.customer_phone) return null;
    const day = order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : 'no_date';
    return `${ot}|${order.outlet_id || ''}|${order.customer_phone}|${day}`;
  }

  return null;
}

/**
 * Returns all UNPAID, non-cancelled orders that share the merge key with the
 * given order (including itself). Cancelled and fully-paid orders are excluded.
 */
export function findMergedOrders<T extends MergeableOrder>(target: T, all: T[]): T[] {
  const key = getMergeKey(target);
  if (!key) return [target];
  const sameKey = all.filter(o => isActiveForBilling(o) && getMergeKey(o) === key);
  return sameKey.length ? sameKey : [target];
}
