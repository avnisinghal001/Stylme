import type { CatalogProduct } from "@/types/catalog";

const CACHE_PREFIX = "stylme.catalog-product.";
const CACHE_TTL_MS = 60 * 60 * 1000;
const memoryCache = new Map<string, CatalogProduct>();

function cacheKey(slug: string) {
  return `${CACHE_PREFIX}${slug}`;
}

export function rememberCatalogProduct(product: CatalogProduct) {
  if (typeof window === "undefined") return;
  memoryCache.set(product.slug, product);
  try {
    window.sessionStorage.setItem(
      cacheKey(product.slug),
      JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, product }),
    );
  } catch {
    // Product navigation must still work when storage is disabled or full.
  }
}

export function readRememberedCatalogProduct(slug: string): CatalogProduct | null {
  if (typeof window === "undefined") return null;
  const remembered = memoryCache.get(slug);
  if (remembered) return remembered;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(slug));
    if (!raw) return null;
    const cached = JSON.parse(raw) as { expiresAt?: unknown; product?: unknown };
    if (typeof cached.expiresAt !== "number" || cached.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(cacheKey(slug));
      return null;
    }
    const product = cached.product as Partial<CatalogProduct> | undefined;
    if (!product || product.slug !== slug || typeof product.id !== "string" || typeof product.title !== "string") {
      window.sessionStorage.removeItem(cacheKey(slug));
      return null;
    }
    const value = product as CatalogProduct;
    memoryCache.set(slug, value);
    return value;
  } catch {
    return null;
  }
}
