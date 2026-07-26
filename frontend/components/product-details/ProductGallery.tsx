'use client';

import { ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { ProductImage } from '@/components/shared/ProductImage';
import type { Product } from '@/types/product';

export function ProductGallery({ product }: { product: Product }) {
  const images = [product.img];
  const [activeImage, setActiveImage] = useState(images[0]);

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Product images">
      <ProductImage imageUrl={activeImage} productName={product.name} width={720} height={720} priority />
      <div className="mt-3 flex gap-2">
        {images.map((image, index) => (
          <button key={`${product.id}-${image}-${index}`} type="button" onClick={() => setActiveImage(image)} className={`w-16 overflow-hidden rounded-md border p-0.5 focus-visible:ring-2 focus-visible:ring-ring ${activeImage === image ? 'border-primary ring-1 ring-primary' : 'border-transparent'}`} aria-label={`View product image ${index + 1}`}>
            <ProductImage imageUrl={image} productName={`${product.name} thumbnail`} width={64} height={64} />
          </button>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ImageIcon className="size-3.5" />{images.length} product image</p>
    </section>
  );
}
