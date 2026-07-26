"use client";

import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { CategorySection } from "@/components/landing/CategorySection";
import { HeroSection } from "@/components/landing/HeroSection";
import { PersonalizedForYou } from "@/components/landing/PersonalizedForYou";
import { ProductSection } from "@/components/landing/ProductSection";
import { PromiseStrip } from "@/components/landing/PromiseStrip";
import { SwoopStylNearby } from "@/components/landing/SwoopStylNearby";
import { getHomeCatalog } from "@/lib/api/catalog";
import type { HomeCatalog } from "@/types/catalog";

export function StorefrontHomeClient() {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; catalog: HomeCatalog } | null>(null);
  const [failure, setFailure] = useState<{ attempt: number; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    void getHomeCatalog()
      .then((value) => { if (active) setResult({ attempt, catalog: value }); })
      .catch((reason) => {
        if (active) setFailure({ attempt, message: reason instanceof Error ? reason.message : "The storefront could not be loaded." });
      });
    return () => { active = false; };
  }, [attempt]);

  const catalog = result?.attempt === attempt ? result.catalog : null;
  const error = failure?.attempt === attempt ? failure.message : "";

  if (!catalog && error) {
    return (
      <div className="mx-auto grid min-h-[60dvh] w-full max-w-2xl place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle className="size-6" /></span>
          <h1 className="mt-4 text-2xl font-black tracking-tight">The styles did not load</h1>
          <p className="mt-2 text-sm text-zinc-500">{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-pink-600 px-5 text-sm font-black text-white"><RefreshCw className="size-4" />Try again</button>
        </div>
      </div>
    );
  }

  if (!catalog) return <HomeCatalogSkeleton />;

  return (
    <div className="flex flex-col gap-y-14 pb-8 sm:gap-y-20">
      <HeroSection products={catalog.featured} />
      <PersonalizedForYou />
      <SwoopStylNearby />
      <CategorySection categories={catalog.categories} />
      <ProductSection eyebrow="Most loved across India" title="Trending right now" description="National picks shoppers are saving, rating and wearing." products={catalog.trending} tinted />
      <PromiseStrip />
      <ProductSection eyebrow="Fresh drop" title="New arrivals" description="New silhouettes, colour stories and everyday staples worth a closer look." products={catalog.newArrivals} href="/products?sort=newest" />
    </div>
  );
}

function HomeCatalogSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[90rem] animate-pulse px-4 py-6 sm:px-6" aria-label="Loading storefront">
      <div className="grid min-h-[34rem] gap-3 lg:grid-cols-[1.45fr_0.55fr]">
        <div className="grid place-items-center rounded-[2rem] bg-zinc-950 text-zinc-400"><div className="text-center"><LoaderCircle className="mx-auto size-7 animate-spin text-pink-400" /><p className="mt-3 text-xs font-bold">Bringing your styles to this browser…</p></div></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1"><div className="rounded-[2rem] bg-pink-100" /><div className="rounded-[2rem] bg-rose-100" /></div>
      </div>
      <div className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="aspect-[4/5] rounded-2xl bg-pink-50" />)}</div>
    </div>
  );
}
