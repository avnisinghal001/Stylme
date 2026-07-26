/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ArrowRight, MapPin, Zap } from "lucide-react";

import { AIStyleStudio } from "@/components/landing/AIStyleStudio";
import { productHref } from "@/components/catalog/catalog-utils";
import { ProfileSearchSignals } from "@/components/storefront/ProfileSearchSignals";
import type { CatalogProduct } from "@/types/catalog";

export function HeroSection({ products }: { products: CatalogProduct[] }) {
  const lead = products[0];
  const secondary = products[1];
  return (
    <section className="mx-auto w-full max-w-[90rem] px-4 pt-5 sm:px-6 sm:pt-7">
      <div className="grid min-h-[34rem] gap-3 lg:grid-cols-[1.45fr_0.55fr]">
        <AIStyleStudio lead={lead} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:grid-rows-2">
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-pink-500 to-rose-700 p-5 text-white sm:p-7">
            <div className="absolute -right-12 -top-12 size-40 rounded-full bg-white/15 blur-2xl" />
            <span className="grid size-10 place-items-center rounded-full bg-white/15"><Zap className="size-5 fill-white" /></span>
            <h2 className="mt-5 text-xl font-black tracking-tight sm:text-2xl">SwoopStyl</h2>
            <p className="mt-2 text-xs leading-5 text-pink-50 sm:text-sm">Distance-first discovery for fashion that can reach you in one day.</p>
            <form action="/products" className="mt-4 flex items-center rounded-full bg-white p-1 shadow-lg shadow-pink-950/20">
              <input type="hidden" name="swoopstyl" value="true" />
              <ProfileSearchSignals mode="catalog" />
              <label htmlFor="swoopstyl-pincode" className="sr-only">Delivery pincode</label>
              <input id="swoopstyl-pincode" name="pincode" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} required placeholder="Enter pincode" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-zinc-900 outline-none placeholder:text-zinc-400" />
              <button type="submit" className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-950 text-white" aria-label="Explore nearby styles"><ArrowRight className="size-3.5" /></button>
            </form>
            <a href="#swoopstyl-nearby" className="mt-3 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-white/85 hover:text-white">Use live location <ArrowRight className="size-3" /></a>
          </div>
          <Link href={secondary ? productHref(secondary) : "/products"} className="group relative overflow-hidden rounded-[2rem] bg-pink-50">
            {secondary?.imageUrl ? <img src={secondary.imageUrl} alt={secondary.title} className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="absolute inset-0 bg-gradient-to-br from-rose-100 to-orange-100" />}
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/75 via-zinc-950/5 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5"><p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-pink-200"><MapPin className="size-3" /> Curated nearby</p><p className="mt-1 line-clamp-2 text-sm font-bold sm:text-base">{secondary?.title ?? "Styles selected for you"}</p></div>
          </Link>
        </div>
      </div>
    </section>
  );
}
