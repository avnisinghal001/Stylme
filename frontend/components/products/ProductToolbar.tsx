'use client';

import { RotateCcw, Search } from 'lucide-react';

import { ProductFilters, type ProductFilterOptions } from './ProductFilters';
import { Button } from '@/components/ui/button';

export interface ProductFilterValues {
  search: string;
  brand: string;
  category: string;
  colour: string;
  status: string;
  sort: 'default' | 'price-asc' | 'price-desc' | 'rating-asc' | 'rating-desc';
}

interface ProductToolbarProps {
  filters: ProductFilterValues;
  options: ProductFilterOptions;
  onFiltersChange: (filters: ProductFilterValues) => void;
  onReset: () => void;
}

export function ProductToolbar({ filters, options, onFiltersChange, onReset }: ProductToolbarProps) {
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Product filters">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full xl:max-w-sm">
          <label className="sr-only" htmlFor="product-search">Search products</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="product-search"
            type="search"
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
            placeholder="Search by product name"
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
          <ProductFilters filters={filters} options={options} onChange={onFiltersChange} />
          <Button variant="ghost" size="sm" onClick={onReset} className="self-start sm:self-auto"><RotateCcw />Reset filters</Button>
        </div>
      </div>
    </section>
  );
}
