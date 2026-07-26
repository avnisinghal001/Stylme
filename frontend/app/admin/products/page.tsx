'use client';

import { Download, Plus, RefreshCw, Upload } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ProductDecisionDialog } from '@/components/products/ProductDecisionDialog';
import { ProductEmptyState } from '@/components/products/ProductEmptyState';
import { ProductPagination } from '@/components/products/ProductPagination';
import { ProductTable } from '@/components/products/ProductTable';
import { ProductToolbar, type ProductFilterValues } from '@/components/products/ProductToolbar';
import { Button, buttonVariants } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { ProductProvider, useProducts } from '@/providers/ProductProvider';
import { useAuth } from '@/providers/AuthProvider';
import { productService, type ProductReviewDecision } from '@/services/product.service';
import type { Product } from '@/types/product';

const PAGE_SIZE = 10;

const initialFilters: ProductFilterValues = {
  search: '',
  brand: 'all',
  category: 'all',
  colour: 'all',
  status: 'all',
  sort: 'default',
};

const categoryFor = (product: Product) => String(product.attributes['Sub Category'] ?? product.attributes.Category ?? 'Uncategorized');

function ProductsManagement() {
  const { products, isLoading, error, refreshProducts } = useProducts();
  const { hasRole } = useAuth();
  const isMarketplaceAdmin = hasRole('admin', 'owner');
  const [filters, setFilters] = useState<ProductFilterValues>(initialFilters);
  const [page, setPage] = useState(1);
  const [decisionTarget, setDecisionTarget] = useState<{ product: Product; decision: ProductReviewDecision } | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const [busyId, setBusyId] = useState('');

  const pendingCount = useMemo(() => products.filter((product) => product.status === 'pending').length, [products]);

  const options = useMemo(() => ({
    brands: [...new Set(products.map((product) => product.brand))].sort(),
    categories: [...new Set(products.map(categoryFor))].sort(),
    colours: [...new Set(products.map((product) => product.colour))].sort(),
  }), [products]);

  const filteredProducts = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const result = products.filter((product) => {
      const matchesSearch = !search || [product.name, product.brand, product.description, product.id]
        .some((value) => value.toLowerCase().includes(search));

      return matchesSearch
        && (filters.brand === 'all' || product.brand === filters.brand)
        && (filters.category === 'all' || categoryFor(product) === filters.category)
        && (filters.colour === 'all' || product.colour === filters.colour)
        && (filters.status === 'all' || product.status === filters.status);
    });

    return result.sort((left, right) => {
      if (filters.sort === 'price-asc') return left.price - right.price;
      if (filters.sort === 'price-desc') return right.price - left.price;
      if (filters.sort === 'rating-desc') return right.avgRating - left.avgRating;
      if (filters.sort === 'rating-asc') return left.avgRating - right.avgRating;
      return 0;
    });
  }, [filters, products]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const paginatedProducts = filteredProducts.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);

  const updateFilters = (nextFilters: ProductFilterValues) => {
    setFilters(nextFilters);
    setPage(1);
  };

  const resetFilters = () => updateFilters(initialFilters);

  const openDecision = (product: Product, decision: ProductReviewDecision) => {
    setDecisionError('');
    setDecisionTarget({ product, decision });
  };

  const confirmDecision = async (reason?: string) => {
    if (!decisionTarget) return;
    const { product, decision } = decisionTarget;
    setBusyId(product.id);
    setDecisionError('');
    try {
      await productService.reviewProductDraft(product.id, decision, reason);
      setDecisionTarget(null);
      toast.success(decision === 'approved' ? `${product.name} is approved and published.` : `${product.name} was returned to the seller.`);
      await refreshProducts();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : 'Could not record this product decision.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        subtitle={isMarketplaceAdmin
          ? 'Manage and review product drafts from every approved seller.'
          : 'Only products owned by your approved seller account are shown here.'}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {isMarketplaceAdmin && <Button variant="outline"><Upload />Upload Dataset</Button>}
            <Button variant="outline"><Download />Export CSV</Button>
            <Button variant="outline" onClick={() => void refreshProducts()} disabled={isLoading}><RefreshCw className={isLoading ? 'animate-spin' : ''} />Refresh</Button>
            <Link href="/admin/upload" className={buttonVariants()}><Plus />Add Product</Link>
          </div>
        }
      />

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {isMarketplaceAdmin && pendingCount > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Product review queue">
          <div>
            <p className="font-medium text-amber-950">{pendingCount} product{pendingCount === 1 ? '' : 's'} waiting for review</p>
            <p className="mt-0.5 text-sm text-amber-800">Approve to publish, or reject with a clear reason for the seller.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => updateFilters({ ...filters, status: 'pending' })} className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100">Show pending only</Button>
        </section>
      )}

      <ProductToolbar filters={filters} options={options} onFiltersChange={updateFilters} onReset={resetFilters} />

      {isLoading ? (
        <ProductTable products={[]} isLoading canReview={isMarketplaceAdmin} />
      ) : filteredProducts.length === 0 ? (
        <ProductEmptyState onReset={resetFilters} />
      ) : (
        <>
          <ProductTable products={paginatedProducts} canReview={isMarketplaceAdmin} onReview={openDecision} />
          <ProductPagination
            currentPage={activePage}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            totalItems={filteredProducts.length}
            onPageChange={setPage}
          />
        </>
      )}

      {decisionTarget && (
        <ProductDecisionDialog
          product={decisionTarget.product}
          decision={decisionTarget.decision}
          busy={busyId === decisionTarget.product.id}
          error={decisionError}
          onClose={() => !busyId && setDecisionTarget(null)}
          onConfirm={(reason) => void confirmDecision(reason)}
        />
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <ProductProvider>
      <ProductsManagement />
    </ProductProvider>
  );
}
