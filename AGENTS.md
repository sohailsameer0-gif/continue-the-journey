# Project notes

## Architecture decisions
- Order creation is enforced server-side by the `trg_gate_order_subscription` BEFORE INSERT trigger on `public.orders` (function `fn_gate_order_on_subscription`): it blocks inserts when the outlet is suspended/deactivated/unapproved or its subscription (paid `paid_until` or free-demo `demo_end_date`) has expired. Admins bypass it. Do not remove this trigger; the public menu also pre-checks state through the `get_outlet_order_gate(slug)` RPC.
- Subscription expiry as displayed to the outlet is computed in `useResolvedSubscription` (src/hooks/useSubscription.ts): a `paid_active` row whose `paid_until` has passed counts as expired even if the status column was not flipped. The outlet panel lock lives in `ProtectedRoute` (renders `src/pages/SubscriptionExpired.tsx`), and `/outlet/subscribe` is deliberately exempt from the lock so the owner can renew.
- Web fonts are loaded via `<link>` tags in `src/routes/__root.tsx` head; never re-add a remote `@import` to `src/styles.css` (Lightning CSS build fails). All `@import` rules must stay at the very top of `src/styles.css`, before `@source`/`@theme`/`@custom-variant`.
