'use client';

import type { ProductFilterValues } from './ProductToolbar';

export interface ProductFilterOptions {
  brands: string[];
  categories: string[];
  colours: string[];
}

interface ProductFiltersProps {
  filters: ProductFilterValues;
  options: ProductFilterOptions;
  onChange: (filters: ProductFilterValues) => void;
}

const selectClassName = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto';

export function ProductFilters({ filters, options, onChange }: ProductFiltersProps) {
  const update = (field: keyof ProductFilterValues, value: string) => onChange({ ...filters, [field]: value } as ProductFilterValues);

  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
      <label className="sr-only" htmlFor="brand-filter">Filter by brand</label>
      <select id="brand-filter" className={selectClassName} value={filters.brand} onChange={(event) => update('brand', event.target.value)}>
        <option value="all">All brands</option>{options.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
      </select>
      <label className="sr-only" htmlFor="category-filter">Filter by category</label>
      <select id="category-filter" className={selectClassName} value={filters.category} onChange={(event) => update('category', event.target.value)}>
        <option value="all">All categories</option>{options.categories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      <label className="sr-only" htmlFor="colour-filter">Filter by colour</label>
      <select id="colour-filter" className={selectClassName} value={filters.colour} onChange={(event) => update('colour', event.target.value)}>
        <option value="all">All colours</option>{options.colours.map((colour) => <option key={colour} value={colour}>{colour}</option>)}
      </select>
      <label className="sr-only" htmlFor="status-filter">Filter by status</label>
      <select id="status-filter" className={selectClassName} value={filters.status} onChange={(event) => update('status', event.target.value)}>
        <option value="all">All statuses</option><option value="approved">Approved</option><option value="pending">Pending</option><option value="draft">Draft</option><option value="rejected">Rejected</option>
      </select>
      <label className="sr-only" htmlFor="sort-filter">Sort products</label>
      <select id="sort-filter" className={selectClassName} value={filters.sort} onChange={(event) => update('sort', event.target.value)}>
        <option value="default">Sort by</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="rating-desc">Rating: high to low</option><option value="rating-asc">Rating: low to high</option>
      </select>
    </div>
  );
}
