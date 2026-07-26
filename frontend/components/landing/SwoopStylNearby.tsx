"use client";

/* eslint-disable @next/next/no-img-element */
import { ArrowRight, Clock3, LocateFixed, MapPin, Navigation, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { API_BASE_URL } from "@/lib/api/client";
import { getPersonalizedProducts, type PersonalizedCatalogProduct } from "@/lib/api/personalization";
import { useAuth } from "@/providers/AuthProvider";

type NearbyProduct = {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  brand: string;
  pricePaise: number;
  distanceKm: number | null;
  label: string;
};

const STORAGE_KEY = "stylme.swoopstyl.pincode";

function productFromApi(value: unknown): NearbyProduct | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const brand = item.brand && typeof item.brand === "object" ? item.brand as Record<string, unknown> : {};
  const price = item.price && typeof item.price === "object" ? item.price as Record<string, unknown> : {};
  const swoop = item.swoopStyl && typeof item.swoopStyl === "object" ? item.swoopStyl as Record<string, unknown> : {};
  if (typeof item.title !== "string") return null;
  return {
    id: String(item.id ?? item.slug ?? item.title),
    slug: String(item.slug ?? item.id ?? ""),
    title: item.title,
    image: typeof item.coverImageUrl === "string" ? item.coverImageUrl : null,
    brand: typeof brand.name === "string" ? brand.name : "StylMe",
    pricePaise: typeof price.salePricePaise === "number" ? price.salePricePaise : 0,
    distanceKm: typeof swoop.distanceKm === "number" ? swoop.distanceKm : null,
    label: typeof item.deliveryLabel === "string" ? item.deliveryLabel : "Arrives in one day",
  };
}

function productFromPersonalized(item: PersonalizedCatalogProduct): NearbyProduct {
  const distance = item.swoopStyl?.distanceKm;
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    image: item.imageUrl,
    brand: item.brand,
    pricePaise: item.pricePaise,
    distanceKm: typeof distance === "number" && Number.isFinite(distance) ? distance : null,
    label: item.deliveryLabel ?? "Arrives in one day",
  };
}

export function SwoopStylNearby() {
  const { user, isLoading: authLoading } = useAuth();
  const [pincode, setPincode] = useState("");
  const [place, setPlace] = useState("");
  const [products, setProducts] = useState<NearbyProduct[]>([]);
  const [status, setStatus] = useState<"idle" | "locating" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Use your location or enter a pincode to see styles that can reach you in one day.");

  const loadProducts = useCallback(async (resolvedPincode: string) => {
    setStatus("loading");
    setMessage("Finding the quickest one-day styles near you…");
    try {
      if (user) {
        const personalized = await getPersonalizedProducts({ pincode: resolvedPincode, swoopStyl: true, limit: 8 });
        const items = personalized.items.map(productFromPersonalized);
        setProducts(items);
        setStatus("ready");
        setMessage(items.length ? `${personalized.total.toLocaleString("en-IN")} one-day styles are ready near ${resolvedPincode}. Closest available options are shown first.` : "No one-day styles match your choices nearby yet.");
        window.localStorage.setItem(STORAGE_KEY, resolvedPincode);
        return;
      }
      const response = await fetch(`${API_BASE_URL}/products?swoopstyl=true&pincode=${encodeURIComponent(resolvedPincode)}&limit=8`, { cache: "no-store" });
      const payload = await response.json() as { items?: unknown[]; total?: number; detail?: unknown };
      if (!response.ok) throw new Error("One-day styles could not be loaded for this pincode.");
      const items = (payload.items ?? []).map(productFromApi).filter((item): item is NearbyProduct => item !== null);
      setProducts(items);
      setStatus("ready");
      setMessage(items.length ? `${Number(payload.total ?? items.length).toLocaleString("en-IN")} styles can reach ${resolvedPincode} in one day. Fastest options are shown first.` : "No one-day styles are available near this pincode yet.");
      window.localStorage.setItem(STORAGE_KEY, resolvedPincode);
    } catch (error) {
      setProducts([]);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Nearby styles could not be loaded.");
    }
  }, [user]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      if (authLoading) return;
      const saved = window.localStorage.getItem(STORAGE_KEY) || user?.defaultPincode;
      if (/^[1-9][0-9]{5}$/.test(saved ?? "")) {
        setPincode(saved!);
        void loadProducts(saved!);
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, [authLoading, loadProducts, user?.defaultPincode]);

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus("error");
      setMessage("This browser does not support location access. Enter your pincode instead.");
      return;
    }
    setStatus("locating");
    setMessage("Waiting for browser location permission…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch(`${API_BASE_URL}/locations/resolve-pincode`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
          cache: "no-store",
        });
        const payload = await response.json() as { pincode?: string; place?: string; detail?: unknown };
        if (!response.ok || !payload.pincode) throw new Error("We could not find one-day delivery near this location.");
        setPincode(payload.pincode);
        setPlace(payload.place ?? "Current area");
        await loadProducts(payload.pincode);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Could not resolve your pincode.");
      }
    }, (error) => {
      setStatus("error");
      setMessage(error.code === error.PERMISSION_DENIED ? "Location permission was not granted. Your pincode still works." : "Your location could not be read. Enter your pincode instead.");
    }, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 10 * 60_000 });
  };

  const submitPincode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (/^[1-9][0-9]{5}$/.test(pincode)) void loadProducts(pincode);
  };

  return (
    <section id="swoopstyl-nearby" className="mx-auto w-full max-w-[90rem] px-4 sm:px-6">
      <div className="relative isolate overflow-hidden rounded-[2rem] bg-[#18040d] text-white shadow-[0_30px_80px_-45px_rgba(219,39,119,0.9)]">
        <div className="absolute -right-20 -top-28 -z-10 size-80 rounded-full bg-pink-500/30 blur-3xl" />
        <div className="border-b border-white/10 px-5 py-5 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-pink-500 text-white shadow-lg shadow-pink-950/40"><Zap className="size-5 fill-current" /></span><div><div className="flex items-center gap-2"><h2 className="text-2xl font-black tracking-[-0.04em]">SwoopStyl</h2><span className="rounded-full bg-lime-300 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-zinc-950">1 day</span></div><p className="text-xs text-pink-100">Nearby fashion, delivered in one day</p></div></div>
            <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={locate} disabled={status === "locating" || status === "loading"} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-4 text-xs font-black text-zinc-950 transition hover:bg-pink-50 disabled:opacity-60">{status === "locating" ? <RefreshCw className="size-4 animate-spin" /> : <LocateFixed className="size-4 text-pink-600" />} Use my location</button><form onSubmit={submitPincode} className="flex h-11 items-center rounded-full border border-white/15 bg-white/10 p-1 backdrop-blur"><MapPin className="ml-2 size-4 text-pink-200" /><input aria-label="SwoopStyl pincode" value={pincode} onChange={(event) => setPincode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[1-9][0-9]{5}" placeholder="Pincode" className="w-28 bg-transparent px-2 text-xs font-semibold text-white outline-none placeholder:text-pink-200/60" /><button aria-label="Load nearby products" className="grid size-9 place-items-center rounded-full bg-pink-500"><ArrowRight className="size-4" /></button></form></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-pink-100"><span className="flex items-center gap-1.5"><Navigation className="size-3.5" />{place || (pincode ? `Delivering near ${pincode}` : "Location not shared")}</span><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />Fastest nearby options first</span><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />{user ? "Your saved fit choices are included" : "Your location is used only for this search"}</span></div>
        </div>
        <div className="px-5 py-5 sm:px-8 sm:py-7"><p aria-live="polite" className={`mb-4 text-xs ${status === "error" ? "text-rose-300" : "text-pink-100"}`}>{message}</p>{products.length > 0 ? <div className="grid auto-cols-[minmax(10.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 sm:auto-cols-[minmax(12rem,1fr)] lg:grid-flow-row lg:grid-cols-4">{products.map((product, index) => <Link key={product.id} href={`/products/${encodeURIComponent(product.slug)}`} className="group overflow-hidden rounded-2xl bg-white text-zinc-950 transition hover:-translate-y-1"><div className="relative aspect-[4/3] overflow-hidden bg-pink-50">{product.image ? <img src={product.image} alt={product.title} className="size-full object-cover object-top transition duration-500 group-hover:scale-105" /> : <div className="grid size-full place-items-center text-xs font-bold text-pink-700">StylMe</div>}<span className="absolute left-2 top-2 rounded-full bg-lime-300 px-2 py-1 text-[9px] font-black text-zinc-950">{index === 0 ? "NEAREST" : "1 DAY"}</span>{product.distanceKm !== null && <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/85 px-2 py-1 text-[9px] font-bold text-white">{product.distanceKm.toFixed(1)} km</span>}</div><div className="p-3"><p className="text-[10px] font-black uppercase tracking-wider text-pink-600">{product.brand}</p><h3 className="mt-1 line-clamp-2 min-h-9 text-xs font-bold">{product.title}</h3><div className="mt-2 flex items-end justify-between gap-2"><span className="text-sm font-black">₹{Math.round(product.pricePaise / 100).toLocaleString("en-IN")}</span><span className="text-[9px] text-zinc-500">{product.label.split("·")[0]}</span></div></div></Link>)}</div> : <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-pink-300/25 bg-white/[0.04] p-6 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-full bg-pink-500/15 text-pink-300"><MapPin /></span><p className="mt-3 text-sm font-bold">Your nearest styles appear here</p><p className="mt-1 text-xs text-pink-100/65">Share your location or enter a pincode to see one-day options.</p></div></div>}</div>
      </div>
    </section>
  );
}
