import { Star } from 'lucide-react';

import type { Product } from '@/types/product';

const categoryFor = (product: Product) => String(product.attributes['Sub Category'] ?? product.attributes.Category ?? 'Uncategorized');

export function ProductBasicInfo({ product }: { product: Product }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <p className="text-sm font-medium text-primary">{product.brand}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{product.name}</h2>
      <p className="mt-2 text-sm text-muted-foreground">Product ID: {product.id}</p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-y py-4 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium"><Star className="size-4 fill-amber-400 text-amber-400" />{product.avgRating.toFixed(1)} rating</span>
        <span className="text-muted-foreground">{product.ratingCount.toLocaleString('en-IN')} ratings</span>
        <span className="text-muted-foreground">{categoryFor(product)}</span>
        <span className="text-muted-foreground">{product.colour}</span>
      </div>
      <p className="mt-5 text-2xl font-semibold text-foreground">₹{product.price.toLocaleString('en-IN')}</p>
    </section>
  );
}
