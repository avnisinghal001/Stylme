"use client";

import Link from "next/link";
import { AlertCircle, Bike, LoaderCircle, RefreshCw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ActiveFilterChips, activeCatalogFilters, catalogClearHref, withoutSwoopStylHref } from "@/components/catalog/ActiveFilterChips";
import { CatalogFilterDrawer } from "@/components/catalog/CatalogFilterDrawer";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { Pagination } from "@/components/catalog/Pagination";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { SearchIntentClient } from "@/components/catalog/SearchIntentClient";
import { parseCatalogQuery, queryRecord } from "@/components/catalog/catalog-query";
import { getAdvancedCatalogPage, getCatalogFilters, getCatalogPage } from "@/lib/api/catalog";
import type { CatalogFilters as CatalogFilterData, CatalogPage, CatalogQuery } from "@/types/catalog";

function compiledQueryParams(queryParams: Record<string, unknown>) {
  const values = Object.fromEntries(
    Object.entries(queryParams).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map(String)
        : value === null || value === undefined
          ? undefined
          : String(value),
    ]),
  );
  return parseCatalogQuery(values);
}

export function CatalogBrowser({ query, pathname, title, description, badge = "StylMe catalog", advanced = false }: {
  query: CatalogQuery;
  pathname: string;
  title: ReactNode;
  description: string;
  badge?: string;
  advanced?: boolean;
}) {
  const [reload, setReload] = useState(0);
  const requestKey = JSON.stringify({ advanced, query, reload });
  const [result, setResult] = useState<{
    key: string;
    page: CatalogPage;
    filters: CatalogFilterData;
    effectiveQuery: CatalogQuery;
    queryParams?: Record<string, unknown>;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    let active = true;

    void (async () => {
      const filtersPromise = getCatalogFilters();
      let nextPage: CatalogPage | null = null;
      let nextQuery = query;
      let nextQueryParams: Record<string, unknown> | undefined;

      if (advanced && query.query?.trim()) {
        const result = await getAdvancedCatalogPage(query);
        if (result) {
          nextPage = result.page;
          nextQueryParams = result.queryParams;
          nextQuery = compiledQueryParams(result.queryParams);
        }
      }
      if (!nextPage) nextPage = await getCatalogPage(query);
      const nextFilters = await filtersPromise;

      if (!active || requestId.current !== currentRequest) return;
      setResult({ key: requestKey, page: nextPage, filters: nextFilters, effectiveQuery: nextQuery, queryParams: nextQueryParams });
    })()
      .catch((reason) => {
        if (active && requestId.current === currentRequest) {
          setFailure({ key: requestKey, message: reason instanceof Error ? reason.message : "The catalogue could not be loaded." });
        }
      });

    return () => { active = false; };
  }, [advanced, query, reload, requestKey]);

  const currentResult = result?.key === requestKey ? result : null;
  const displayResult = currentResult ?? result;
  const error = failure?.key === requestKey ? failure.message : "";
  const loading = !currentResult && !error;
  const page = displayResult?.page ?? null;
  const filters = displayResult?.filters ?? null;
  const effectiveQuery = displayResult?.effectiveQuery ?? query;
  const queryParams = currentResult?.queryParams;

  if (!page || !filters) {
    if (error) return <CatalogLoadError message={error} onRetry={() => setReload((value) => value + 1)} />;
    return <CatalogBrowserSkeleton title={title} description={description} />;
  }

  const formValues = {
    q: effectiveQuery.query,
    lexical: effectiveQuery.lexicalQuery,
    brand: effectiveQuery.brand,
    category: effectiveQuery.category,
    productType: effectiveQuery.productType,
    colour: effectiveQuery.colour,
    size: effectiveQuery.size,
    gender: effectiveQuery.gender,
    profileGender: effectiveQuery.profileGender,
    profileAge: effectiveQuery.profileAge === undefined ? undefined : String(effectiveQuery.profileAge),
    profileHeightCm: effectiveQuery.profileHeightCm === undefined ? undefined : String(effectiveQuery.profileHeightCm),
    profileWeightKg: effectiveQuery.profileWeightKg === undefined ? undefined : String(effectiveQuery.profileWeightKg),
    metadata: effectiveQuery.metadata,
    minPrice: effectiveQuery.minPrice === undefined ? undefined : String(effectiveQuery.minPrice),
    maxPrice: effectiveQuery.maxPrice === undefined ? undefined : String(effectiveQuery.maxPrice),
    minAge: effectiveQuery.minAge === undefined ? undefined : String(effectiveQuery.minAge),
    maxAge: effectiveQuery.maxAge === undefined ? undefined : String(effectiveQuery.maxAge),
    minHeightCm: effectiveQuery.minHeightCm === undefined ? undefined : String(effectiveQuery.minHeightCm),
    maxHeightCm: effectiveQuery.maxHeightCm === undefined ? undefined : String(effectiveQuery.maxHeightCm),
    minWeightKg: effectiveQuery.minWeightKg === undefined ? undefined : String(effectiveQuery.minWeightKg),
    maxWeightKg: effectiveQuery.maxWeightKg === undefined ? undefined : String(effectiveQuery.maxWeightKg),
    sort: effectiveQuery.sort,
    pincode: effectiveQuery.pincode,
    swoopStyl: effectiveQuery.swoopStyl,
    intentParsed: effectiveQuery.intentParsed,
  };
  const activeFilters = activeCatalogFilters(effectiveQuery, pathname);
  const clearHref = catalogClearHref(effectiveQuery, pathname);
  const withoutSwoopStyl = withoutSwoopStylHref(effectiveQuery, pathname);
  const navigationKey = JSON.stringify(effectiveQuery);

  return (
    <div className="relative mx-auto w-full max-w-[90rem] overflow-x-clip px-4 py-6 sm:px-6 sm:py-8 lg:py-10" aria-busy={loading}>
      <SearchIntentClient queryParams={queryParams} />
      {loading && <div className="absolute inset-x-4 top-0 h-0.5 overflow-hidden rounded-full bg-pink-100 sm:inset-x-6"><div className="h-full w-1/2 animate-pulse bg-pink-600" /></div>}
      <header className="mb-6 max-w-3xl sm:mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-pink-700 sm:text-xs"><Sparkles className="size-3.5" /> {badge}</span>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.045em] text-zinc-950 sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500 sm:text-base sm:leading-7">{description}</p>
      </header>

      {error && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="size-5 shrink-0" />
          <p className="min-w-0 flex-1">The latest update did not load. Your current results and filters are still here.</p>
          <button type="button" onClick={() => setReload((value) => value + 1)} className="inline-flex shrink-0 items-center gap-1 font-black"><RefreshCw className="size-3.5" /> Retry</button>
        </div>
      )}

      {effectiveQuery.swoopStyl && effectiveQuery.pincode && (
        <section className="mb-6 flex items-center gap-3 rounded-2xl border border-pink-100 bg-white px-4 py-3 shadow-sm sm:gap-4 sm:px-5" aria-label="One-day delivery is active">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-pink-50 text-pink-600"><Bike className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-black text-zinc-950">Need it fast?</p><p className="mt-0.5 text-xs text-zinc-500">Showing styles that can reach {effectiveQuery.pincode} in 1 day.</p></div>
          <Link href={withoutSwoopStyl} className="hidden shrink-0 text-xs font-black text-pink-600 hover:text-pink-800 sm:inline">Not in a hurry</Link>
          <Link href={withoutSwoopStyl} aria-label="Turn off one-day delivery" className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800"><X className="size-4" /></Link>
        </section>
      )}

      <CatalogFilterDrawer activeCount={activeFilters.length} resultCount={page.total}>
        <CatalogFilters filters={filters} values={formValues} action={pathname} clearHref={clearHref} idPrefix="mobile-catalog" navigationKey={navigationKey} pending={loading} />
      </CatalogFilterDrawer>

      <div className="flex items-start gap-6 xl:gap-8">
        <aside className="sticky top-20 hidden h-[calc(100dvh-6rem)] min-h-0 max-h-[46rem] w-[18.5rem] shrink-0 flex-col overflow-hidden rounded-3xl border border-pink-100 bg-white shadow-[0_18px_50px_-35px_rgba(190,24,93,0.55)] lg:flex xl:w-80" aria-label="Catalog filter panel">
          <div className="flex shrink-0 items-center justify-between border-b border-pink-100 px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-pink-50 text-pink-600"><SlidersHorizontal className="size-4" /></span>
              <div><h2 className="font-black text-zinc-950">Filters</h2><p className="text-[11px] text-zinc-500">Refine your results</p></div>
            </div>
            {activeFilters.length > 0 && <span className="rounded-full bg-pink-100 px-2.5 py-1 text-[11px] font-black text-pink-700">{activeFilters.length}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-5">
            <CatalogFilters filters={filters} values={formValues} action={pathname} clearHref={clearHref} idPrefix="desktop-catalog" navigationKey={navigationKey} pending={loading} />
          </div>
        </aside>

        <section className={`min-w-0 flex-1 pt-5 transition-opacity lg:pt-0 ${loading ? "opacity-70" : "opacity-100"}`} aria-label="Product results">
          <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
            <p aria-live="polite"><span className="font-black text-zinc-950">{page.total.toLocaleString("en-IN")}</span> {page.total === 1 ? "style" : "styles"} found{effectiveQuery.swoopStyl && effectiveQuery.pincode ? ` near ${effectiveQuery.pincode}` : ""}</p>
            {page.source === "demo" && <span className="max-w-full truncate rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800">Preview styles</span>}
          </div>
          <ActiveFilterChips items={activeFilters} clearHref={clearHref} />
          <ProductGrid products={page.items} />
          <Pagination page={page.page} totalPages={page.totalPages} pathname={pathname} params={queryRecord(effectiveQuery)} />
        </section>
      </div>
    </div>
  );
}

function CatalogBrowserSkeleton({ title, description }: { title: ReactNode; description: string }) {
  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 sm:py-8 lg:py-10" aria-label="Loading catalogue">
      <header className="mb-8 max-w-3xl"><div className="h-7 w-36 animate-pulse rounded-full bg-pink-50" /><h1 className="mt-3 text-3xl font-black tracking-[-0.045em] sm:text-5xl">{title}</h1><p className="mt-3 text-sm text-zinc-500 sm:text-base">{description}</p></header>
      <div className="flex items-start gap-8"><aside className="hidden h-[34rem] w-80 animate-pulse rounded-3xl border border-pink-100 bg-pink-50/50 lg:block" /><section className="min-w-0 flex-1"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-pink-700"><LoaderCircle className="size-4 animate-spin" />Loading styles in your browser…</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="aspect-[4/5] animate-pulse rounded-2xl bg-pink-50" />)}</div></section></div>
    </div>
  );
}

function CatalogLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto grid min-h-[60dvh] max-w-xl place-items-center px-6 text-center">
      <div><span className="mx-auto grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle className="size-6" /></span><h1 className="mt-4 text-2xl font-black">The catalogue did not load</h1><p className="mt-2 text-sm leading-6 text-zinc-500">{message}</p><button type="button" onClick={onRetry} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-pink-600 px-5 text-sm font-black text-white"><RefreshCw className="size-4" />Try again</button></div>
    </div>
  );
}
