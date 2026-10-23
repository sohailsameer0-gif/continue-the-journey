import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logoImage from '@/assets/menuqr-logo.png';
import { PLAN_LABEL } from '@/lib/plans';
import { useOutlet } from '@/hooks/useData';
import { useResolvedSubscription } from '@/hooks/useSubscription';

/**
 * Shown when an outlet's subscription (paid plan or free trial) has expired.
 * The whole outlet panel is locked; renewing via /outlet/subscribe restores access.
 */
export default function SubscriptionExpired() {
  const navigate = useNavigate();
  const { data: outlet } = useOutlet();
  const resolved = useResolvedSubscription(outlet?.id);
  const sub = resolved.data;

  const planName = sub ? PLAN_LABEL[sub.plan] : null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src={logoImage}
            alt="MenuQR logo"
            width={48}
            height={48}
            className="h-12 w-12 rounded-xl object-contain"
            decoding="async"
          />
          <span className="font-heading font-bold text-lg text-foreground">MenuQR</span>
        </div>

        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            {sub?.isDemo ? 'Free Trial Ended' : 'Subscription Expired'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {outlet?.name ? `"${outlet.name}"` : 'Your outlet'}
            {planName ? ` (${planName})` : ''} can no longer use the panel. Your menu stays online but
            new orders are stopped until you renew.
          </p>
        </div>

        <Button variant="hero" size="lg" className="w-full" onClick={() => navigate('/outlet/subscribe')}>
          <CreditCard className="mr-2 h-5 w-5" /> Renew / Upgrade Now
        </Button>

        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <LifeBuoy className="h-3.5 w-3.5" />
          Need help? Contact admin support from the subscription page.
        </p>
      </div>
    </div>
  );
}
