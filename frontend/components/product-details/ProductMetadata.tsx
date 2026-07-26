import { CalendarDays, History } from 'lucide-react';

import type { Product } from '@/types/product';

const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));

export function ProductMetadata({ product }: { product: Product }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Metadata</h2>
      <dl className="mt-4 space-y-4 text-sm">
        <div className="flex gap-3"><CalendarDays className="mt-0.5 size-4 text-muted-foreground" /><div><dt className="text-muted-foreground">Created date</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(product.createdAt)}</dd></div></div>
        <div className="flex gap-3"><History className="mt-0.5 size-4 text-muted-foreground" /><div><dt className="text-muted-foreground">Last updated</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(product.updatedAt)}</dd></div></div>
      </dl>
    </section>
  );
}
