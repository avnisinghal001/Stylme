'use client';

import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import PageHeader from '@/components/layout/PageHeader';
import { RejectedTable, type RejectedProduct } from '@/components/rejected/RejectedTable';
import { Button } from '@/components/ui/button';
import { submitProductDraft } from '@/lib/ai/python-api';
import { productService } from '@/services/product.service';
import { useAuth } from '@/providers/AuthProvider';

const formatDate = (value: string) => new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export default function RejectedPage() {
  const { hasRole } = useAuth();
  const [products, setProducts] = useState<RejectedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const items = await productService.getManagedProducts({ status: 'rejected' });
      setProducts(items.map((item) => ({
        id: item.id,
        product: item.name,
        sku: item.sku,
        brand: item.brand,
        reason: item.rejectionReason ?? 'Seller action required',
        rejectedAt: formatDate(item.updatedAt),
      })));
    } catch (cause) {
      setProducts([]);
      setError(cause instanceof Error ? cause.message : 'Could not load rejected products.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const revalidate = async (id: string) => {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await submitProductDraft(id);
      setNotice('Product resubmitted for review.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not resubmit this product.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rejected Products"
        subtitle={hasRole('admin', 'owner')
          ? 'Review rejected drafts from all approved sellers.'
          : 'Only rejected products owned by your seller account are shown.'}
        actions={<Button variant="outline" onClick={() => void load()} disabled={isLoading}><RefreshCw className={isLoading ? 'animate-spin' : ''} />Refresh</Button>}
      />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {isLoading ? <div className="grid min-h-64 place-items-center rounded-xl border bg-card"><LoaderCircle className="size-7 animate-spin text-primary" aria-label="Loading rejected products" /></div> : <RejectedTable products={products} busyId={busyId} onRevalidate={(id) => void revalidate(id)} />}
    </div>
  );
}
