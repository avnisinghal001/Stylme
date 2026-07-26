'use client';

import { Check, LoaderCircle, RefreshCw, Store, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { decideSeller, listSellers } from '@/lib/api/client';
import type { SellerSummary } from '@/types/auth';

export default function SellersPage() {
  const [items, setItems] = useState<SellerSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try { setItems((await listSellers()).items); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load sellers.'); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    const reason = decision === 'rejected' ? window.prompt('Reason for rejection?') ?? '' : undefined;
    if (decision === 'rejected' && !reason?.trim()) return;
    setBusyId(id);
    try { await decideSeller(id, decision, reason); await load(); }
    catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : 'Decision failed.'); }
    finally { setBusyId(null); }
  }

  return <div className="space-y-6"><PageHeader title="Seller approvals" subtitle="Owner and admin review queue for marketplace access." />{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}<div className="flex justify-end"><Button variant="outline" onClick={() => void load()} disabled={isLoading}><RefreshCw className={isLoading ? 'animate-spin' : ''} />Refresh</Button></div><div className="overflow-hidden rounded-2xl border"><div className="grid grid-cols-[1fr_130px_170px] gap-4 border-b bg-pink-50/60 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>Seller</span><span>Status</span><span>Actions</span></div>{isLoading ? <div className="grid h-40 place-items-center"><LoaderCircle className="animate-spin text-primary" /></div> : items.length === 0 ? <div className="grid h-48 place-items-center text-center"><div><Store className="mx-auto size-8 text-pink-300" /><p className="mt-3 font-medium">No seller applications</p></div></div> : items.map((seller) => <div key={seller.id} className="grid grid-cols-[1fr_130px_170px] items-center gap-4 border-b px-5 py-4 last:border-b-0"><div><p className="font-medium">{seller.displayName}</p><p className="text-sm text-muted-foreground">{seller.email}</p><p className="mt-1 text-xs text-muted-foreground">{seller.locations} location{seller.locations === 1 ? '' : 's'} · {seller.brands} brand{seller.brands === 1 ? '' : 's'}</p></div><span className="w-fit rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium capitalize text-primary">{seller.status}</span><div className="flex gap-2">{seller.status === 'pending' ? <><Button size="sm" onClick={() => void decide(seller.id, 'approved')} disabled={busyId === seller.id}><Check />Approve</Button><Button size="sm" variant="destructive" onClick={() => void decide(seller.id, 'rejected')} disabled={busyId === seller.id}><X />Reject</Button></> : <span className="text-xs text-muted-foreground">Decision recorded</span>}</div></div>)}</div></div>;
}
