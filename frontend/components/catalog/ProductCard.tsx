"use client";

import Link from "next/link";
import { ArrowUpRight, Heart, MapPin, Star, Zap } from "lucide-react";

import { formatInr, productHref } from "@/components/catalog/catalog-utils";
import { rememberCatalogProduct } from "@/lib/catalog-product-cache";
import type { CatalogProduct } from "@/types/catalog";

export function ProductCard({ product, compact = false }: { product: CatalogProduct; compact?: boolean }) {
  const hasDiscount = product.mrpPaise > product.pricePaise;
  const discountLabel = Math.round(product.discountPercent);

  return (
    <article className="group relative flex min-w-0 h-full flex-col overflow-hidden rounded-xl border border-pink-100 bg-white shadow-[0_2px_18px_-12px_rgba(255,63,108,0.45)] transition duration-300 hover:-translate-y-1 hover:border-pink-200 hover:shadow-[0_20px_34px_-20px_rgba(255,63,108,0.55)] sm:rounded-2xl">
      <Link href={productHref(product)} onClick={() => rememberCatalogProduct(product)} className="relative block overflow-hidden bg-pink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-inset">
        <div className="aspect-[4/5] overflow-hidden">
          {product.imageUrl ? (
            // External catalog URLs are intentionally rendered as plain images.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.title}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="grid size-full place-items-center bg-gradient-to-br from-pink-100 via-rose-50 to-orange-50 px-6 text-center text-sm font-semibold text-pink-800">
              {product.title}
            </div>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        {product.discountPercent > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-white/92 px-2 py-1 text-[10px] font-bold text-pink-700 shadow-sm backdrop-blur sm:left-2.5 sm:top-2.5 sm:px-2.5 sm:text-[11px]">
            {discountLabel}% off
          </span>
        )}
        <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-white/90 text-zinc-600 shadow-sm backdrop-blur transition hover:text-pink-600 sm:right-2.5 sm:top-2.5 sm:size-8" aria-label="Save for later">
          <Heart className="size-3.5 sm:size-4" />
        </span>
      </Link>

      <div className={compact ? "flex flex-1 flex-col gap-1.5 p-3" : "flex flex-1 flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-3.5"}>
        <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.08em] text-zinc-900 sm:text-xs sm:font-bold">{product.brand}</p>
            <Link href={productHref(product)} onClick={() => rememberCatalogProduct(product)} className="mt-0.5 block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500">
              <h2 className="line-clamp-2 text-xs font-medium leading-4 text-zinc-700 transition-colors group-hover:text-pink-700 sm:line-clamp-1 sm:text-sm sm:leading-normal">{product.title}</h2>
            </Link>
          </div>
          {product.rating > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-md border border-zinc-200 px-1 py-0.5 text-[9px] font-semibold text-zinc-700 sm:gap-1 sm:px-1.5 sm:py-1 sm:text-[11px]">
              {product.rating.toFixed(1)} <Star className="size-2.5 fill-emerald-500 text-emerald-500 sm:size-3" />
            </span>
          )}
        </div>

        {!compact && product.shortDescription && (
          <p className="hidden line-clamp-2 text-xs leading-relaxed text-zinc-500 sm:block">{product.shortDescription}</p>
        )}

        <div className="mt-auto flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pt-1">
          <span className="text-xs font-black text-zinc-950 sm:text-sm sm:font-bold">{formatInr(product.pricePaise)}</span>
          {hasDiscount && <span className="text-[10px] text-zinc-400 line-through sm:text-xs">{formatInr(product.mrpPaise)}</span>}
          {hasDiscount && <span className="hidden text-xs font-semibold text-orange-600 sm:inline">({discountLabel}% OFF)</span>}
        </div>

        {product.swoopStylEligible ? (
          <p className="hidden items-center gap-1 text-[11px] font-semibold text-pink-700 sm:flex">
            <Zap className="size-3 fill-pink-600" /> Get it in 1 day with SwoopStyl
          </p>
        ) : product.deliveryLabel ? (
          <p className="hidden items-center gap-1 text-[11px] text-zinc-500 sm:flex">
            <MapPin className="size-3" /> {product.deliveryLabel}
          </p>
        ) : null}

        <Link href={productHref(product)} onClick={() => rememberCatalogProduct(product)} className="mt-1 hidden items-center justify-center gap-1 rounded-full border border-pink-200 px-3 py-2 text-xs font-semibold text-pink-700 transition hover:border-pink-500 hover:bg-pink-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 sm:inline-flex">
          View style <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
