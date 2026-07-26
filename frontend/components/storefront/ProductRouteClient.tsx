"use client";

import Link from "next/link";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { ProductSection } from "@/components/landing/ProductSection";
import { ProductDetail } from "@/components/storefront/ProductDetail";
import { getCatalogProduct, getRelatedProducts } from "@/lib/api/catalog";
import { readRememberedCatalogProduct, rememberCatalogProduct } from "@/lib/catalog-product-cache";
import type { CatalogProduct } from "@/types/catalog";

export function ProductRouteClient() {
  const params = useParams<{ slug: string | string[] }>();
  const slug = useMemo(() => Array.isArray(params.slug) ? params.slug[0] : params.slug, [params.slug]);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${slug ?? ""}:${attempt}`;
  const [result, setResult] = useState<{ key: string; product: CatalogProduct | null; related: CatalogProduct[]; notFound: boolean } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const cachedSnapshot = useCallback(() => slug ? readRememberedCatalogProduct(slug) : null, [slug]);
  const cachedProduct = useSyncExternalStore(() => () => undefined, cachedSnapshot, () => null);

  useEffect(() => {
    if (!slug) return;
    let active = true;

    void getCatalogProduct(slug)
      .then((value) => {
        if (!active) return;
        if (!value) {
          setResult({ key: requestKey, product: null, related: [], notFound: true });
          return;
        }
        rememberCatalogProduct(value);
        setResult({ key: requestKey, product: value, related: [], notFound: false });
        void getRelatedProducts(value).then((suggestions) => {
          if (active) {
            setResult({
              key: requestKey,
              product: value,
              related: suggestions,
              notFound: false,
            });
          }
        });
      })
      .catch((reason) => {
        if (active) setFailure({ key: requestKey, message: reason instanceof Error ? reason.message : "This product could not be loaded." });
      });

    return () => { active = false; };
  }, [requestKey, slug]);

  const currentResult = result?.key === requestKey ? result : null;
  const error = failure?.key === requestKey ? failure.message : "";
  const product = currentResult ? currentResult.product : cachedProduct;
  const related = currentResult?.related ?? [];
  const notFound = currentResult?.notFound ?? false;
  const loading = !currentResult && !error;

  if (!product && loading) return <ProductClientSkeleton />;

  if (!product && (notFound || error)) {
    return (
      <div className="mx-auto grid min-h-[65dvh] max-w-xl place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle className="size-6" /></span>
          <h1 className="mt-4 text-2xl font-black tracking-tight">{notFound ? "This style is no longer available" : "This style did not load"}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{error || "It may have moved, sold out, or been unpublished."}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {!notFound && <button type="button" onClick={() => setAttempt((value) => value + 1)} className="inline-flex h-11 items-center gap-2 rounded-full bg-pink-600 px-5 text-sm font-black text-white"><RefreshCw className="size-4" />Try again</button>}
            <Link href="/products" className="inline-flex h-11 items-center rounded-full border border-pink-200 px-5 text-sm font-black text-pink-700">Browse styles</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!product) return <ProductClientSkeleton />;
  const variantKey = product.offers.flatMap((offer) => offer.variants.map((variant) => variant.id)).join(":");
  return (
    <>
      {loading && <div className="fixed inset-x-0 top-16 z-40 h-0.5 overflow-hidden bg-pink-100"><div className="h-full w-1/2 animate-pulse bg-pink-600" /></div>}
      <ProductDetail key={`${product.id}:${variantKey}`} product={product} />
      {related.length > 0 && <ProductSection eyebrow="Complete the look" title="You may also like" description="Related styles from the same category or brand." products={related} />}
    </>
  );
}

function ProductClientSkeleton() {
  return <div className="mx-auto grid w-full max-w-[90rem] animate-pulse gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.25fr_0.75fr]" aria-label="Loading product"><div className="grid grid-cols-2 gap-3"><div className="aspect-[4/5] rounded-2xl bg-pink-100" /><div className="aspect-[4/5] rounded-2xl bg-pink-50" /></div><div className="space-y-4"><LoaderCircle className="size-5 animate-spin text-pink-600" /><div className="h-4 w-24 rounded bg-pink-100" /><div className="h-10 w-4/5 rounded bg-pink-100" /><div className="h-4 w-full rounded bg-zinc-100" /><div className="h-14 w-full rounded-xl bg-pink-100" /></div></div>;
}
