"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Check, Heart, MapPin, ShieldCheck, ShoppingBag, Sparkles, Star, Truck, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { formatInr } from "@/components/catalog/catalog-utils";
import { addCustomerCartItem } from "@/lib/api/client";
import { useAuth } from "@/providers/AuthProvider";
import type { CatalogProduct } from "@/types/catalog";

export function ProductDetail({ product }: { product: CatalogProduct }) {
  const router = useRouter();
  const { user } = useAuth();
  const images = product.gallery.length ? product.gallery : product.imageUrl ? [product.imageUrl] : [];
  const selections = useMemo(() => product.offers.flatMap((offer) => offer.variants.map((variant) => ({ offer, variant }))).filter((item) => item.variant.available), [product.offers]);
  const [selectionKey, setSelectionKey] = useState(selections[0] ? `${selections[0].offer.id}:${selections[0].variant.id}` : "");
  const [adding, setAdding] = useState(false);
  const selection = selections.find((item) => `${item.offer.id}:${item.variant.id}` === selectionKey);
  const displayedPrice = selection?.offer.pricePaise ?? product.pricePaise;
  const displayedMrp = selection?.offer.mrpPaise ?? product.mrpPaise;
  const displayedDiscount = displayedMrp > displayedPrice ? Math.round((1 - displayedPrice / displayedMrp) * 100) : 0;
  const addToCart = async () => {
    if (!user) { router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`); return; }
    if (!selection) { toast.error("Choose an available size and colour first."); return; }
    setAdding(true);
    try { await addCustomerCartItem(selection.offer.id, selection.variant.id); toast.success(`${selection.variant.sizeKey} added to your cart.`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not add this option."); }
    finally { setAdding(false); }
  };
  return (
    <article className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6 lg:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-xs text-zinc-500"><Link href="/" className="hover:text-pink-700">Home</Link><span>/</span><Link href={`/products?category=${encodeURIComponent(product.category)}`} className="hover:text-pink-700">{product.category}</Link><span>/</span><span className="text-zinc-800">{product.title}</span></nav>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <div className="grid grid-cols-2 gap-3">
          {(images.length ? images.slice(0, 4) : [null]).map((image, index) => <div key={image ?? index} className={`overflow-hidden rounded-2xl bg-pink-50 ${index === 0 && images.length === 1 ? "col-span-2" : ""}`}><div className="aspect-[4/5]">{image ? <img src={image} alt={`${product.title}${index ? ` view ${index + 1}` : ""}`} className="size-full object-cover" /> : <div className="grid size-full place-items-center px-8 text-center font-bold text-pink-700">{product.title}</div>}</div></div>)}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-zinc-900">{product.brand}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">{product.title}</h1>
          <p className="mt-2 text-base text-zinc-500">{product.shortDescription}</p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"><span>{product.rating ? product.rating.toFixed(1) : "New"}</span>{product.rating > 0 && <Star className="size-4 fill-emerald-500 text-emerald-500" />}<span className="h-4 w-px bg-zinc-200" /><span className="font-normal text-zinc-500">{product.ratingCount.toLocaleString("en-IN")} ratings</span></div>
          <div className="my-6 border-y border-zinc-200 py-5">
            <div className="flex flex-wrap items-baseline gap-2"><span className="text-2xl font-bold">{formatInr(displayedPrice)}</span>{displayedMrp > displayedPrice && <span className="text-sm text-zinc-400 line-through">MRP {formatInr(displayedMrp)}</span>}{displayedDiscount > 0 && <span className="font-bold text-orange-600">({displayedDiscount}% OFF)</span>}</div>
            <p className="mt-1 text-xs font-semibold text-emerald-700">inclusive of all taxes</p>
          </div>

          {product.colour && <p className="text-sm"><span className="font-bold">Colour:</span> {product.colour}</p>}
          {selections.length > 0 && <fieldset className="mt-5"><legend className="text-sm font-bold">Select a size and colour</legend><p className="mt-1 text-xs text-zinc-500">Choose an available option.</p><div className="mt-3 flex flex-wrap gap-2">{selections.map(({ offer, variant }) => { const key = `${offer.id}:${variant.id}`; const family = product.colourFamilies[0]; return <button key={key} type="button" onClick={() => setSelectionKey(key)} aria-pressed={selectionKey === key} className={`min-h-11 rounded-full border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 ${selectionKey === key ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-300 hover:border-pink-600 hover:text-pink-700"}`}>{variant.sizeKey.replaceAll("_", " ")}{family ? ` · ${family}` : ""}</button>; })}</div></fieldset>}

          <div className="mt-6 grid grid-cols-[1fr_auto] gap-3"><button type="button" onClick={addToCart} disabled={adding || !selection} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-bold text-white transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"><ShoppingBag className="size-5" />{adding ? "Adding…" : "Add to cart"}</button><button type="button" aria-label="Add to wishlist" className="grid size-12 place-items-center rounded-xl border border-zinc-300 text-zinc-700 transition hover:border-pink-500 hover:text-pink-700"><Heart className="size-5" /></button></div>
          {selection && <p className="mt-2 text-xs text-zinc-500">Selected: <strong>{selection.variant.sizeKey.replaceAll("_", " ")}</strong> from {selection.offer.sellerName ?? "approved seller"}. <Link href="/account/cart" className="font-bold text-pink-700">Open cart</Link></p>}

          <div className="mt-6 rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
            <p className="flex items-center gap-2 font-bold text-pink-800"><Zap className="size-4 fill-pink-600" /> SwoopStyl delivery</p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">We prioritise nearby seller inventory for one-day delivery. Enter your pincode at checkout to confirm.</p>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-zinc-600"><MapPin className="size-4 text-pink-600" /> Fastest nearby option first</div>
          </div>

          <dl className="mt-6 grid gap-3 text-sm text-zinc-600"><div className="flex items-center gap-2"><Truck className="size-4 text-pink-600" /><span>Free delivery on eligible orders</span></div><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-pink-600" /><span>Quality-checked seller inventory</span></div><div className="flex items-center gap-2"><Check className="size-4 text-pink-600" /><span>Easy size and fit review</span></div></dl>
        </div>
      </div>

      <section className="mt-12 grid gap-6 border-t border-zinc-200 pt-10 lg:grid-cols-[2fr_1fr]"><div><span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-3 py-1 text-xs font-bold text-pink-700"><Sparkles className="size-3" /> Why it works</span><h2 className="mt-3 text-2xl font-bold">Product details</h2><p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-zinc-600">{product.description}</p></div><div><h2 className="text-sm font-bold uppercase tracking-wider">Style details</h2><div className="mt-3 flex flex-wrap gap-2">{[product.productType, ...product.tags].filter(Boolean).slice(0, 10).map((tag) => <span key={tag} className="rounded-full border border-pink-100 bg-pink-50 px-3 py-1.5 text-xs font-semibold text-pink-800">{tag}</span>)}</div></div></section>
    </article>
  );
}
