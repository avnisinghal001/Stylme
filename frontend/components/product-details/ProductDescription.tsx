import type { Product } from '@/types/product';

export function ProductDescription({ product }: { product: Product }) {
  return <section className="rounded-xl border bg-card p-5"><h2 className="text-base font-semibold text-foreground">Description</h2><p className="mt-3 leading-6 text-muted-foreground">{product.description}</p></section>;
}
