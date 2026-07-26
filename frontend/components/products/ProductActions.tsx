'use client';

import { Check, Eye, Pencil, X } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProductReviewDecision } from '@/services/product.service';
import type { Product } from '@/types/product';

interface ProductActionsProps {
  product: Product;
  canReview?: boolean;
  onReview?: (product: Product, decision: ProductReviewDecision) => void;
}

export function ProductActions({ product, canReview = false, onReview }: ProductActionsProps) {
  const href = `/admin/products/${encodeURIComponent(product.id)}`;
  const isPendingReview = product.status === 'pending';

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canReview && isPendingReview && onReview ? (
        <>
          <Button size="sm" onClick={() => onReview(product, 'approved')} className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Check />Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onReview(product, 'rejected')}>
            <X />Reject
          </Button>
        </>
      ) : product.status === 'draft' || product.status === 'rejected' ? (
        <Link href={`${href}?mode=edit`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          <Pencil />Edit
        </Link>
      ) : null}
      <Link href={href} aria-label={`View ${product.name}`} title={`View ${product.name}`} className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}>
        <Eye className="size-4" />
      </Link>
    </div>
  );
}
