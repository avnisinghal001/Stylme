import { Star } from 'lucide-react';

import type { Product } from '@/lib/mock-products';

export function ProductInfo({ product }: { product: Product }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <p className="text-sm font-medium text-primary">{product.brand}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{product.productName}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium"><Star className="size-4 fill-amber-400 text-amber-400" />{product.rating.toFixed(1)} rating</span>
        <span className="text-muted-foreground">Product ID: {product.id}</span>
      </div>
      <p className="mt-5 text-2xl font-semibold text-foreground">₹{product.price.toLocaleString('en-IN')}</p>
      <div className="mt-5 border-t pt-5">
        <h2 className="text-sm font-semibold text-foreground">Description</h2>
        <p className="mt-2 leading-6 text-muted-foreground">A thoughtfully designed {product.color.toLowerCase()} {product.subcategory.toLowerCase()} from {product.brand}. This catalogue listing is ready for product-quality review and merchandising.</p>
      </div>
    </section>
  );
}
