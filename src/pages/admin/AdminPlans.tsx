import { useState } from 'react';
import { useAdminOutlets, useUpdateSubscriptionAdmin } from '@/hooks/useAdminData';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function AdminPlans() {
  const { data: outlets, isLoading } = useAdminOutlets();
  const updateSub = useUpdateSubscriptionAdmin();
  const [editing, setEditing] = useState<any | null>(null);
  const [plan, setPlan] = useState<'free_demo' | 'basic' | 'standard' | 'pro'>('basic');
  const [status, setStatus] = useState<'active' | 'paid_active' | 'expired' | 'suspended'>('paid_active');
  const [extendDays, setExtendDays] = useState('30');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const openEdit = (sub: any) => {
    setEditing(sub);
    setPlan(sub.plan);
    setStatus(sub.status);
    setExtendDays('30');
  };

  const handleSave = async () => {
    if (!editing) return;
    const days = Number(extendDays || 0);
    const updates: any = { id: editing.id, plan, status };
    if (days > 0) {
      // Extend the correct date based on plan
      if (plan === 'free_demo') {
        const base = editing.demo_end_date && new Date(editing.demo_end_date) > new Date()
          ? new Date(editing.demo_end_date)
          : new Date();
        updates.demo_end_date = new Date(base.getTime() + days * 86400000).toISOString();
      } else {
        const base = editing.paid_until && new Date(editing.paid_until) > new Date()
          ? new Date(editing.paid_until)
          : new Date();
        updates.paid_until = new Date(base.getTime() + days * 86400000).toISOString();
      }
    }
    await updateSub.mutateAsync(updates);
    toast.success('Subscription updated');
    setEditing(null);
  };

  const handleMarkExpired = async (sub: any) => {
    await updateSub.mutateAsync({ id: sub.id, status: 'expired' });
    toast.success('Marked expired');
  };

  const handleSuspend = async (sub: any) => {
    await updateSub.mutateAsync({ id: sub.id, status: 'suspended' });
    toast.success('Subscription suspended');
  };

  const handleReactivate = async (sub: any) => {
    await updateSub.mutateAsync({ id: sub.id, status: sub.plan === 'free_demo' ? 'active' : 'paid_active' });
    toast.success('Subscription reactivated');
  };

  const handleQuickExtend = async (sub: any, days: number) => {
    const updates: any = { id: sub.id };
    if (sub.plan === 'free_demo') {
      const base = sub.demo_end_date && new Date(sub.demo_end_date) > new Date()
        ? new Date(sub.demo_end_date) : new Date();
      updates.demo_end_date = new Date(base.getTime() + days * 86400000).toISOString();
      updates.status = 'active';
    } else {
      const base = sub.paid_until && new Date(sub.paid_until) > new Date()
        ? new Date(sub.paid_until) : new Date();
      updates.paid_until = new Date(base.getTime() + days * 86400000).toISOString();
      updates.status = 'paid_active';
    }
    await updateSub.mutateAsync(updates);
    toast.success(`Extended by ${days} days`);
  };

  const filtered = (outlets ?? []).filter((o: any) => {
    const sub = o.subscriptions?.[0];
    if (!sub) return false;
    if (search && !o.name.toLowerCase().includes(search.toLowerCase()) && !o.slug.toLowerCase().includes(search.toLowerCase())) return false;
    if (planFilter !== 'all' && sub.plan !== planFilter) return false;
    if (statusFilter !== 'all' && sub.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground">Plans & Subscriptions</h1>
        <p className="text-muted-foreground text-sm">Activate, extend or downgrade outlet plans</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search outlet name or slug..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All plans" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="free_demo">Free Trial</SelectItem>
            <SelectItem value="basic">Basic</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="pro">Premium</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active (demo)</SelectItem>
            <SelectItem value="paid_active">Paid Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Renews / Ends</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No outlets match your filters</TableCell></TableRow>
                  )}
                  {filtered.map((o: any) => {
                    const sub = o.subscriptions?.[0];
                    if (!sub) return null;
                    const endDate = sub.plan === 'free_demo' ? sub.demo_end_date : sub.paid_until;
                    const daysLeft = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000) : null;
                    return (
                      <TableRow key={o.id}>
                        <TableCell>
                          <p className="font-medium">{o.name}</p>
                          <p className="text-xs text-muted-foreground">{o.slug}</p>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{sub.plan.replace('_', ' ')}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={sub.status === 'paid_active' ? 'default' : sub.status === 'suspended' ? 'destructive' : 'outline'} className={sub.status === 'paid_active' ? 'bg-green-600 hover:bg-green-600' : ''}>
                            {sub.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <div className="text-foreground">{endDate ? format(new Date(endDate), 'dd MMM yyyy') : '—'}</div>
                            {daysLeft !== null && (
                              <div className={daysLeft < 0 ? 'text-destructive' : daysLeft <= 7 ? 'text-amber-600' : 'text-muted-foreground'}>
                                {daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end flex-wrap">
                            <Button size="sm" variant="ghost" onClick={() => handleQuickExtend(sub, 30)}>+30d</Button>
                            <Button size="sm" variant="outline" onClick={() => openEdit(sub)}>Manage</Button>
                            {sub.status === 'suspended' ? (
                              <Button size="sm" variant="ghost" onClick={() => handleReactivate(sub)}>Reactivate</Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => handleSuspend(sub)}>Suspend</Button>
                            )}
                            {sub.status !== 'expired' && (
                              <Button size="sm" variant="ghost" onClick={() => handleMarkExpired(sub)}>Expire</Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Subscription</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={plan} onValueChange={v => setPlan(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free_demo">Free Trial</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="pro">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active (demo)</SelectItem>
                  <SelectItem value="paid_active">Paid Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Extend by (days, 0 = no change)</Label>
              <Input type="number" value={extendDays} onChange={e => setExtendDays(e.target.value)} />
              <p className="text-xs text-muted-foreground">Adds to existing renewal date if active, otherwise from today.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
