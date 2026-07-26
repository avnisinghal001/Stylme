'use client';

import Image from 'next/image';
import { useState } from 'react';

const PRODUCT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"%3E%3Crect width="400" height="500" fill="%23f3f4f6"/%3E%3Cpath d="M128 164h144l24 72-35 21v125H139V257l-35-21 24-72Z" fill="%23d1d5db"/%3E%3Ccircle cx="200" cy="122" r="40" fill="%23d1d5db"/%3E%3C/svg%3E';

export interface ProductImageProps {
  imageUrl?: string;
  productName: string;
  width: number;
  height: number;
  priority?: boolean;
}

function ProductImageContent({ imageUrl, productName, width, height, priority = false }: ProductImageProps) {
  const [source, setSource] = useState(imageUrl?.trim() || PRODUCT_PLACEHOLDER);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(!imageUrl?.trim());

  const showFallback = () => {
    if (isFallback) {
      setIsLoading(false);
      return;
    }

    setIsFallback(true);
    setIsLoading(true);
    setSource(PRODUCT_PLACEHOLDER);
  };

  return (
    <div
      aria-busy={isLoading}
      className="relative w-full overflow-hidden rounded-lg bg-muted"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {isLoading && (
        <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
      )}
      <Image
        fill
        unoptimized
        priority={priority}
        src={source}
        alt={productName}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className={`object-cover transition-opacity duration-200 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setIsLoading(false)}
        onError={showFallback}
      />
    </div>
  );
}

export function ProductImage(props: ProductImageProps) {
  return <ProductImageContent key={props.imageUrl} {...props} />;
}
