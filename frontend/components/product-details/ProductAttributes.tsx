import { Layers3 } from 'lucide-react';

import type { Product, ProductAttributeValue } from '@/types/product';

const formatValue = (value: ProductAttributeValue) => Array.isArray(value) ? value.join(', ') : value;

export function ProductAttributes({ product }: { product: Product }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2"><Layers3 className="size-4 text-muted-foreground" /><h2 className="text-base font-semibold text-foreground">Product attributes</h2></div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {Object.entries(product.attributes).map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/20 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium text-foreground">{formatValue(value)}</dd></div>)}
      </dl>
    </section>
  );
}
