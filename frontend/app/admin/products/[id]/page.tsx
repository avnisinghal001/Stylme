'use client';

import { ArrowLeft, Check, Save, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { toast } from 'sonner';

import { EditableProductForm } from '@/components/product-details/EditableProductForm';
import { ProductAttributes } from '@/components/product-details/ProductAttributes';
import { ProductBasicInfo } from '@/components/product-details/ProductBasicInfo';
import { ProductDescription } from '@/components/product-details/ProductDescription';
import { ProductGallery } from '@/components/product-details/ProductGallery';
import { ProductMetadata } from '@/components/product-details/ProductMetadata';
import { ProductQualityCard } from '@/components/product-details/ProductQualityCard';
import { ProductTags } from '@/components/product-details/ProductTags';
import { ProductDecisionDialog } from '@/components/products/ProductDecisionDialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { ProductProvider, useProducts } from '@/providers/ProductProvider';
import { productService, type ProductReviewDecision } from '@/services/product.service';

function ProductDetailsContent({ id }: { id: string }) {
  const { products, isLoading, refreshProducts } = useProducts();
  const { hasRole } = useAuth();
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState<ProductReviewDecision | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const [isDeciding, setIsDeciding] = useState(false);
  const product = products.find((item) => item.id === id);

  if (isLoading) {
    return <div className="space-y-6"><div className="h-16 animate-pulse rounded-xl bg-muted" /><div className="grid gap-6 xl:grid-cols-3"><div className="aspect-square animate-pulse rounded-xl bg-muted" /><div className="h-96 animate-pulse rounded-xl bg-muted xl:col-span-2" /></div></div>;
  }

  if (!product) {
    return <section className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center"><h1 className="text-xl font-semibold">Product not found</h1><p className="mt-2 text-sm text-muted-foreground">This product is unavailable in the current catalogue data.</p></section>;
  }

  const handleSave = () => setNotice('Changes saved to this local preview.');
  const handleCancel = () => setNotice('Edits discarded.');
  const canReview = hasRole('admin', 'owner') && product.status === 'pending';
  const canEdit = product.status === 'draft' || product.status === 'rejected';

  const confirmDecision = async (reason?: string) => {
    if (!decision) return;
    setIsDeciding(true);
    setDecisionError('');
    try {
      await productService.reviewProductDraft(product.id, decision, reason);
      toast.success(decision === 'approved' ? `${product.name} is approved and published.` : `${product.name} was returned to the seller.`);
      if (decision === 'approved') {
        router.replace('/admin/products');
        return;
      }
      setDecision(null);
      await refreshProducts();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : 'Could not record this product decision.');
    } finally {
      setIsDeciding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Products / {product.id}</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Product details</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/products" className={cn(buttonVariants({ variant: 'ghost' }))}><ArrowLeft />Back to products</Link>
          {canEdit && <Button type="submit" form="product-edit-form"><Save />Save changes</Button>}
          {canReview && <Button onClick={() => { setDecisionError(''); setDecision('approved'); }} className="bg-emerald-600 text-white hover:bg-emerald-700"><Check />Approve & publish</Button>}
          {canReview && <Button variant="destructive" onClick={() => { setDecisionError(''); setDecision('rejected'); }}><X />Reject</Button>}
          {canEdit && <Button variant="ghost" form="product-edit-form" type="reset">Cancel</Button>}
        </div>
      </div>

      {notice && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">{notice}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)_minmax(260px,0.7fr)]">
        <div className="space-y-6"><ProductGallery product={product} /><ProductTags product={product} /></div>
        <div className="space-y-6"><ProductBasicInfo product={product} /><ProductDescription product={product} />{canEdit && <EditableProductForm product={product} onSave={handleSave} onCancel={handleCancel} />}<ProductAttributes product={product} /></div>
        <div className="space-y-6"><ProductQualityCard product={product} /><ProductMetadata product={product} /></div>
      </div>

      {decision && (
        <ProductDecisionDialog
          product={product}
          decision={decision}
          busy={isDeciding}
          error={decisionError}
          onClose={() => !isDeciding && setDecision(null)}
          onConfirm={(reason) => void confirmDecision(reason)}
        />
      )}
    </div>
  );
}

export default function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return <ProductProvider><ProductDetailsContent id={id} /></ProductProvider>;
}
