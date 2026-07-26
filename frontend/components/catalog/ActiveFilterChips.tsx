import { X } from "lucide-react";
import Link from "next/link";

import { queryRecord } from "@/components/catalog/catalog-query";
import type { CatalogQuery } from "@/types/catalog";

type ActiveFilter = { key: string; label: string; href: string };
type QueryRecord = Record<string, string | string[] | undefined>;

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hrefFor(pathname: string, params: QueryRecord) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (key === "page") return;
    if (Array.isArray(value)) value.forEach((item) => { if (item) search.append(key, item); });
    else if (value) search.set(key, value);
  });
  const suffix = search.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

export function catalogClearHref(query: CatalogQuery, pathname: string) {
  return hrefFor(pathname, { q: query.query });
}

export function withoutSwoopStylHref(query: CatalogQuery, pathname: string) {
  return hrefFor(pathname, {
    ...queryRecord(query),
    swoopstyl: undefined,
    pincode: undefined,
  });
}

export function activeCatalogFilters(query: CatalogQuery, pathname: string): ActiveFilter[] {
  const base = queryRecord(query);
  const items: ActiveFilter[] = [];

  const addArray = (field: keyof CatalogQuery, parameter: string, prefix: string) => {
    const values = query[field];
    if (!Array.isArray(values)) return;
    values.forEach((value) => {
      const params = { ...base, [parameter]: values.filter((item) => item !== value) };
      items.push({ key: `${parameter}:${value}`, label: `${prefix}: ${titleCase(value)}`, href: hrefFor(pathname, params) });
    });
  };

  addArray("category", "category", "Category");
  addArray("productType", "productType", "Type");
  addArray("brand", "brand", "Brand");
  addArray("colour", "colour", "Colour");
  addArray("size", "size", "Size");
  addArray("gender", "gender", "For");

  Object.entries(query.metadata ?? {}).forEach(([field, values]) => {
    values.forEach((value) => {
      const target = `${field}:${value}`;
      const metadata = (base.meta ?? []) as string[];
      items.push({
        key: `meta:${target}`,
        label: `${titleCase(field)}: ${titleCase(value)}`,
        href: hrefFor(pathname, { ...base, meta: metadata.filter((item) => item !== target) }),
      });
    });
  });

  const addRange = (key: string, label: string, lowKey: keyof CatalogQuery, highKey: keyof CatalogQuery, unit = "") => {
    const low = query[lowKey];
    const high = query[highKey];
    if (typeof low !== "number" && typeof high !== "number") return;
    const lowText = typeof low === "number" ? `${unit}${low.toLocaleString("en-IN")}` : "Any";
    const highText = typeof high === "number" ? `${unit}${high.toLocaleString("en-IN")}` : "Any";
    items.push({ key, label: `${label}: ${lowText}–${highText}`, href: hrefFor(pathname, { ...base, [String(lowKey)]: undefined, [String(highKey)]: undefined }) });
  };

  addRange("price", "Price", "minPrice", "maxPrice", "₹");
  addRange("age", "Age", "minAge", "maxAge");
  addRange("height", "Height", "minHeightCm", "maxHeightCm");
  addRange("weight", "Weight", "minWeightKg", "maxWeightKg");

  if (query.swoopStyl) {
    items.push({ key: "swoopstyl", label: query.pincode ? `1-day delivery: ${query.pincode}` : "1-day delivery", href: hrefFor(pathname, { ...base, swoopstyl: undefined, pincode: undefined }) });
  }

  return items;
}

export function ActiveFilterChips({ items, clearHref }: { items: ActiveFilter[]; clearHref: string }) {
  if (!items.length) return null;
  return (
    <div className="mb-5 flex min-w-0 items-center gap-2" aria-label="Active filters">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 text-xs font-bold text-zinc-500">Active</span>
        {items.map((item) => (
          <Link key={item.key} href={item.href} aria-label={`Remove ${item.label} filter`} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-3 text-xs font-bold text-pink-800 transition hover:border-pink-300 hover:bg-pink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500">
            {item.label}<X className="size-3.5" />
          </Link>
        ))}
      </div>
      <Link href={clearHref} className="inline-flex h-9 shrink-0 items-center px-1 text-xs font-bold text-zinc-500 underline-offset-4 hover:text-pink-700 hover:underline sm:px-2">Clear all</Link>
    </div>
  );
}
