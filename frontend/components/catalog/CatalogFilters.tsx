import { ChevronDown, Ruler, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { CatalogFilterForm, CatalogFilterSubmitButton } from "@/components/catalog/CatalogFilterForm";
import { PriceRangeSlider } from "@/components/catalog/PriceRangeSlider";
import { SearchableMultiFilter } from "@/components/catalog/SearchableMultiFilter";
import type { CatalogFilters as CatalogFilterData, CatalogSort } from "@/types/catalog";

type FilterValues = {
  q?: string;
  lexical?: string;
  brand?: string[];
  category?: string[];
  productType?: string[];
  colour?: string[];
  size?: string[];
  gender?: string[];
  profileGender?: string[];
  profileAge?: string;
  profileHeightCm?: string;
  profileWeightKg?: string;
  metadata?: Record<string, string[]>;
  minPrice?: string;
  maxPrice?: string;
  minAge?: string;
  maxAge?: string;
  minHeightCm?: string;
  maxHeightCm?: string;
  minWeightKg?: string;
  maxWeightKg?: string;
  sort?: CatalogSort;
  pincode?: string;
  swoopStyl?: boolean;
  intentParsed?: boolean;
};

const inputClass = "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

// Core controls replace their matching registry field. Colour family remains a
// separate controlled facet because one canonical colour can belong to more than
// one broad family (for example maroon can be red and brown).
const represented = new Set(["category", "size", "color"]);

function selectionKey(name: string, values?: string[]) {
  return `${name}:${(values ?? []).join("|")}`;
}

export function CatalogFilters({ filters, values, action = "/products", clearHref = action, idPrefix = "catalog", navigationKey, pending = false }: {
  filters: CatalogFilterData;
  values: FilterValues;
  action?: string;
  clearHref?: string;
  idPrefix?: string;
  navigationKey?: string;
  pending?: boolean;
}) {
  const productTypeField = filters.fields.find((field) => field.key === "product_type");
  const categoryField = filters.fields.find((field) => field.key === "category");
  const sizeField = filters.fields.find((field) => field.key === "size");
  const dynamicFields = filters.fields.filter((field) => !represented.has(field.key) && field.key !== "product_type");
  const hasAdvancedRange = Boolean(values.minAge || values.maxAge || values.minHeightCm || values.maxHeightCm || values.minWeightKg || values.maxWeightKg);

  return (
    <CatalogFilterForm action={action} appliedStateKey={navigationKey ?? JSON.stringify(values)} externalPending={pending}>
      {values.q && <input type="hidden" name="q" value={values.q} />}
      {values.lexical && <input type="hidden" name="lexical" value={values.lexical} />}
      {values.intentParsed && <input type="hidden" name="intent" value="1" />}
      {values.swoopStyl && <input type="hidden" name="swoopstyl" value="true" />}
      {values.pincode && <input type="hidden" name="pincode" value={values.pincode} />}
      {values.profileGender?.map((value) => <input key={value} type="hidden" name="profileGender" value={value} />)}
      {values.profileAge && <input type="hidden" name="profileAge" value={values.profileAge} />}
      {values.profileHeightCm && <input type="hidden" name="profileHeightCm" value={values.profileHeightCm} />}
      {values.profileWeightKg && <input type="hidden" name="profileWeightKg" value={values.profileWeightKg} />}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <div className="border-b border-zinc-100 py-4">
          <label htmlFor={`${idPrefix}-sort`} className="mb-2 block text-sm font-bold text-zinc-900">Sort by</label>
          <div className="relative">
            <select key={`sort:${values.sort ?? "recommended"}`} id={`${idPrefix}-sort`} name="sort" defaultValue={values.sort ?? "recommended"} className={`${inputClass} appearance-none pr-10 font-semibold`}>
              <option value="recommended">Recommended</option>
              <option value="newest">Newest first</option>
              <option value="rating">Customer rating</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>

        <SearchableMultiFilter key={selectionKey("category", values.category)} name="category" label="Category" selected={values.category} options={categoryField?.options ?? filters.categories.map((value) => ({ value, label: value }))} initiallyOpen />
        {productTypeField && <SearchableMultiFilter key={selectionKey("productType", values.productType)} name="productType" label="Product type" selected={values.productType} options={productTypeField.options} />}
        <SearchableMultiFilter key={selectionKey("brand", values.brand)} name="brand" label="Brand" selected={values.brand} options={filters.brands.map((value) => ({ value, label: value }))} />
        <SearchableMultiFilter key={selectionKey("colour", values.colour)} name="colour" label="Colour" selected={values.colour} options={filters.colours.map((value) => ({ value, label: value }))} />
        <SearchableMultiFilter key={selectionKey("size", values.size)} name="size" label="Size" selected={values.size} options={sizeField?.options ?? filters.sizes.map((value) => ({ value, label: value }))} />
        <PriceRangeSlider key={`price:${values.minPrice ?? ""}:${values.maxPrice ?? ""}`} minimum={filters.priceBounds.min} maximum={filters.priceBounds.max} initialMinimum={values.minPrice ? Number(values.minPrice) : undefined} initialMaximum={values.maxPrice ? Number(values.maxPrice) : undefined} />

        <details className="group border-b border-zinc-100" open={hasAdvancedRange || undefined}>
          <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-bold text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pink-500 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><Ruler className="size-4 text-zinc-400" /> Fit & profile ranges</span>
            <ChevronDown className="size-4 text-zinc-400 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="space-y-4 pb-4">
            <RangePair key={`age:${values.minAge ?? ""}:${values.maxAge ?? ""}`} label="Age" unit="years" minName="minAge" maxName="maxAge" minimum={0} maximum={110} low={values.minAge} high={values.maxAge} />
            <RangePair key={`height:${values.minHeightCm ?? ""}:${values.maxHeightCm ?? ""}`} label="Height" unit="cm" minName="minHeightCm" maxName="maxHeightCm" minimum={40} maximum={260} low={values.minHeightCm} high={values.maxHeightCm} />
            <RangePair key={`weight:${values.minWeightKg ?? ""}:${values.maxWeightKg ?? ""}`} label="Weight" unit="kg" minName="minWeightKg" maxName="maxWeightKg" minimum={2} maximum={400} low={values.minWeightKg} high={values.maxWeightKg} />
          </div>
        </details>

        {dynamicFields.map((field) => {
          const name = field.key === "gender" ? "gender" : "meta";
          const selected = field.key === "gender" ? values.gender ?? [] : values.metadata?.[field.key] ?? [];
          return <SearchableMultiFilter key={selectionKey(field.key, selected)} label={field.label} name={name} selected={selected} initiallyOpen={selected.length > 0} options={field.options.map((option) => ({ ...option, submitValue: field.key === "gender" ? option.value : `${field.key}:${option.value}` }))} />;
        })}

        <p className="my-4 flex gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-[11px] leading-4 text-zinc-500">
          <SlidersHorizontal className="mt-0.5 size-3.5 shrink-0 text-pink-600" />
          Pick more than one option inside a group to broaden your matches.
        </p>
      </div>

      <div className="z-10 -mx-5 mt-auto shrink-0 border-t border-pink-100 bg-white/95 px-5 py-4 backdrop-blur-xl">
        <CatalogFilterSubmitButton />
        <Link href={clearHref} className="mt-2 flex h-9 items-center justify-center rounded-xl text-xs font-bold text-zinc-500 transition hover:bg-zinc-50 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500">Clear all filters</Link>
      </div>
    </CatalogFilterForm>
  );
}

function RangePair({ label, unit, minName, maxName, minimum, maximum, low, high }: {
  label: string;
  unit: string;
  minName: string;
  maxName: string;
  minimum: number;
  maximum: number;
  low?: string;
  high?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold text-zinc-600">{label} <span className="font-medium text-zinc-400">({unit})</span></legend>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input aria-label={`Minimum ${label}`} name={minName} type="number" min={minimum} max={maximum} defaultValue={low} placeholder="Min" className={inputClass} />
        <span className="text-xs text-zinc-400">to</span>
        <input aria-label={`Maximum ${label}`} name={maxName} type="number" min={minimum} max={maximum} defaultValue={high} placeholder="Max" className={inputClass} />
      </div>
    </fieldset>
  );
}
