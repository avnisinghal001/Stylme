import { PackageSearch } from "lucide-react";

import { ProductCard } from "@/components/catalog/ProductCard";
import type { CatalogProduct } from "@/types/catalog";

export function ProductGrid({ products }: { products: CatalogProduct[] }) {
  if (!products.length) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-pink-200 bg-pink-50/40 px-6 text-center">
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-white text-pink-600 shadow-sm"><PackageSearch className="size-6" /></span>
          <h2 className="mt-4 font-semibold text-zinc-900">No styles matched</h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">Clear a filter or try a broader search such as “festive”, “denim”, or “relaxed”.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-2 gap-x-2.5 gap-y-4 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
