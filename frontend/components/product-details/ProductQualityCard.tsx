import { BadgeCheck, ClipboardCheck } from 'lucide-react';

import { ProductStatusBadge } from '@/components/products/ProductStatusBadge';
import type { Product } from '@/types/product';

export function ProductQualityCard({ product }: { product: Product }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-foreground">Quality review</h2><p className="mt-1 text-sm text-muted-foreground">Catalogue readiness and approval state.</p></div><ClipboardCheck className="size-5 text-muted-foreground" /></div>
      <div className="mt-5 flex items-end justify-between rounded-lg bg-muted/50 p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quality score</p><p className="mt-1 text-3xl font-semibold text-foreground">{product.qualityScore}<span className="text-lg">%</span></p></div><BadgeCheck className="size-8 text-emerald-600" /></div>
      <div className="mt-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">Approval status</span><ProductStatusBadge status={product.status} /></div>
    </section>
  );
}
