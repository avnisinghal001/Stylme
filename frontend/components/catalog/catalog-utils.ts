import type { CatalogProduct } from "@/types/catalog";

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.max(0, paise) / 100);
}

export function productHref(product: Pick<CatalogProduct, "slug">): string {
  return `/products/${encodeURIComponent(product.slug)}`;
}

export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
