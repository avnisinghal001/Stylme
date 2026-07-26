"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, Check, ExternalLink, LoaderCircle, RotateCcw, Search, Send, SlidersHorizontal, Sparkles, X } from "lucide-react";

import { createAiSession, getAiStarterConfig, sendAiMessage } from "@/lib/api/ai-control-plane";
import { formatInr } from "@/components/catalog/catalog-utils";
import type { AiChatMessage, AiComponent, AiSearchPlan, AiSessionStart, AiStarterConfig } from "@/types/ai-agents";
import type { CatalogProduct } from "@/types/catalog";

const FALLBACK_STARTERS = [
  "A maroon festive look under ₹2,500",
  "Minimal office outfits for Delhi weather",
  "Gen-Z brunch look that can arrive tomorrow",
];

type ProductShape = Record<string, unknown>;

export function AIStyleStudio({ lead }: { lead?: CatalogProduct }) {
  const [config, setConfig] = useState<AiStarterConfig | null>(null);
  const [session, setSession] = useState<AiSessionStart | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latestPlan, setLatestPlan] = useState<AiSearchPlan | null>(null);
  const [latestSearchQuery, setLatestSearchQuery] = useState<Record<string, unknown> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAiStarterConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

  const starters = config?.starterPrompts?.length ? config.starterPrompts : FALLBACK_STARTERS;
  const latestUserText = messages.findLast((message) => message.role === "user")?.text ?? "";
  const searchHref = useMemo(
    () => buildSearchHref(latestSearchQuery, latestPlan, latestUserText),
    [latestPlan, latestSearchQuery, latestUserText],
  );

  async function ask(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setOpen(true);
    setInput("");
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text: value }]);
    try {
      const active = session ?? (await createAiSession());
      if (!session) setSession(active);
      const reply = await sendAiMessage(active.sessionId, active.sessionToken, value);
      setMessages((current) => [...current, reply.message]);
      setLatestPlan(reply.plan);
      const queryParams = recordValue(recordValue(reply.search).queryParams);
      setLatestSearchQuery(Object.keys(queryParams).length ? queryParams : null);
    } catch {
      const message = "Your stylist is taking a short break. Try again in a moment.";
      setError(message);
      setMessages((current) => [...current, { role: "assistant", text: "I couldn't finish that style search just now. You can still search StylMe in your own words." }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  function reset() {
    setSession(null);
    setMessages([]);
    setLatestPlan(null);
    setLatestSearchQuery(null);
    setError("");
    setInput("");
  }

  return (
    <>
      <div className="relative isolate overflow-hidden rounded-[2rem] bg-zinc-950 px-6 py-8 text-white sm:px-10 sm:py-12 lg:px-14 lg:py-14">
        {lead?.imageUrl && <><img src={lead.imageUrl} alt="" aria-hidden className="absolute inset-0 -z-20 size-full object-cover object-top opacity-50" /><div className="absolute inset-0 -z-10 bg-gradient-to-r from-zinc-950 via-zinc-950/90 to-zinc-950/25" /></>}
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-300/30 bg-pink-400/10 px-3 py-1.5 text-xs font-black text-pink-100 backdrop-blur"><Sparkles className="size-3.5 text-pink-300" /> Your personal style search</span>
          <h1 className="mt-6 text-4xl font-black leading-[0.98] tracking-[-0.05em] sm:text-6xl lg:text-7xl">Say the vibe.<br /><span className="bg-gradient-to-r from-pink-300 via-rose-300 to-orange-200 bg-clip-text text-transparent">Style it together.</span></h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-zinc-200 sm:text-base">Describe the mood, moment, city, activity, budget or delivery speed. Your stylist will bring back real looks you can shop.</p>
          <form onSubmit={submit} className="mt-7 flex max-w-xl items-center rounded-[1.35rem] bg-white p-1.5 shadow-2xl shadow-pink-950/30">
            <Bot className="ml-3 size-5 shrink-0 text-pink-600" />
            <label htmlFor="hero-ai-style" className="sr-only">Ask the StylMe stylist</label>
            <input id="hero-ai-style" value={input} onChange={(event) => setInput(event.target.value)} placeholder="e.g. maroon festive outfit under ₹2500" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400" />
            <button type="submit" disabled={!input.trim() || busy} className="flex h-10 shrink-0 items-center gap-2 rounded-2xl bg-pink-600 px-4 text-xs font-black text-white transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"><span className="hidden sm:inline">Find my style</span><ArrowRight className="size-4" /></button>
          </form>
          <div className="mt-5 flex flex-wrap gap-2">
            {starters.slice(0, 3).map((starter) => <button key={starter} type="button" onClick={() => void ask(starter)} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-left text-xs text-zinc-200 transition hover:border-pink-300/40 hover:bg-pink-300/15 hover:text-white">{starter}</button>)}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400"><Check className="size-3 text-emerald-400" /> Real prices, available stock and honest delivery promises.</p>
        </div>
      </div>

      {open && <div className="fixed inset-0 z-[100] bg-zinc-950/70 p-0 backdrop-blur-md sm:p-4" role="dialog" aria-modal="true" aria-label="StylMe stylist">
        <div className="mx-auto grid h-full max-w-[92rem] overflow-hidden bg-[#fffafa] shadow-2xl sm:rounded-[2rem] lg:grid-cols-[16rem_minmax(0,1fr)_19rem]">
          <aside className="hidden border-r border-pink-100 bg-zinc-950 p-5 text-white lg:flex lg:flex-col">
            <div className="flex items-center gap-2 text-sm font-black"><span className="grid size-8 place-items-center rounded-xl bg-pink-600"><Sparkles className="size-4" /></span> StylMe Stylist</div>
            <button type="button" onClick={reset} className="mt-7 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2.5 text-xs font-bold text-zinc-200 hover:bg-white/10"><RotateCcw className="size-3.5" /> New style chat</button>
            <div className="mt-8"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Try asking</p><div className="mt-3 space-y-2">{starters.slice(0, 3).map((starter) => <button key={starter} type="button" onClick={() => void ask(starter)} className="w-full rounded-xl bg-white/5 p-3 text-left text-xs leading-5 text-zinc-300 hover:bg-white/10">{starter}</button>)}</div></div>
            <p className="mt-auto text-[10px] leading-4 text-zinc-500">Your chat stays private to this session unless you choose to save a preference.</p>
          </aside>

          <main className="flex min-h-0 flex-col">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-pink-100 bg-white px-4 sm:px-6">
              <div><p className="flex items-center gap-1.5 text-sm font-black text-zinc-950"><span className="size-2 rounded-full bg-emerald-500" /> {config?.name ?? "StylMe Web Stylist"}</p><p className="text-[10px] text-zinc-500">English · Hindi · Hinglish</p></div>
              <div className="flex items-center gap-2"><button type="button" onClick={reset} className="grid size-9 place-items-center rounded-full border border-zinc-200 text-zinc-600 lg:hidden" aria-label="New chat"><RotateCcw className="size-4" /></button><button type="button" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full bg-zinc-100 text-zinc-800 hover:bg-zinc-200" aria-label="Close stylist"><X className="size-4" /></button></div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              <div className="mx-auto max-w-3xl space-y-5">
                {messages.length === 0 && <div className="py-12 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-pink-100 text-pink-700"><Bot className="size-6" /></span><h2 className="mt-4 text-2xl font-black tracking-tight text-zinc-950">What are we styling?</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">{config?.greeting ?? "Tell me the look, occasion, budget, or delivery need—you can speak naturally."}</p></div>}
                {messages.map((message, index) => <ChatBubble key={`${message.role}-${index}`} message={message} />)}
                {searchHref && !busy && !error && <div className="flex items-center gap-3 py-1" aria-label="Continue to all matching search results"><span className="h-px flex-1 bg-gradient-to-r from-transparent to-pink-200" /><Link href={searchHref} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-pink-200 bg-white px-5 text-xs font-black text-pink-700 shadow-sm transition hover:border-pink-600 hover:bg-pink-600 hover:text-white">See more <ArrowRight className="size-3.5" /></Link><span className="h-px flex-1 bg-gradient-to-l from-transparent to-pink-200" /></div>}
                {busy && <div className="flex items-center gap-3 text-sm text-zinc-500"><span className="grid size-8 place-items-center rounded-xl bg-pink-100 text-pink-700"><LoaderCircle className="size-4 animate-spin" /></span><span>Finding your closest style matches…</span></div>}
                {error && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><p>{error}</p><Link href={`/search?q=${encodeURIComponent(messages.findLast((item) => item.role === "user")?.text ?? "")}`} className="mt-2 inline-flex items-center gap-1 font-black">Use regular search <ExternalLink className="size-3" /></Link></div>}
                <div ref={endRef} />
              </div>
            </div>
            <form onSubmit={submit} className="shrink-0 border-t border-pink-100 bg-white p-3 sm:p-5"><div className="mx-auto flex max-w-3xl items-end rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-[0_16px_50px_-30px_rgba(190,24,93,0.5)] focus-within:border-pink-300"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (input.trim()) void ask(input); } }} rows={1} placeholder="Refine the look, add a budget, colour or delivery need…" className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none" /><button type="submit" disabled={!input.trim() || busy} className="grid size-10 shrink-0 place-items-center rounded-xl bg-pink-600 text-white disabled:opacity-40" aria-label="Send"><Send className="size-4" /></button></div><p className="mt-2 text-center text-[10px] text-zinc-400">Check the final size, price and delivery promise before buying.</p></form>
          </main>

          <aside className="hidden overflow-y-auto border-l border-pink-100 bg-white p-5 lg:block"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-zinc-900"><SlidersHorizontal className="size-4 text-pink-600" /> Your style choices</p><PlanPanel plan={latestPlan} /><div className="mt-6 rounded-2xl bg-pink-50 p-4"><p className="text-xs font-black text-pink-900">What you can trust</p><p className="mt-2 text-[11px] leading-5 text-pink-900/70">Every result is a real listing. SwoopStyl appears only when nearby stock can reach your pincode in one day.</p></div></aside>
        </div>
      </div>}
    </>
  );
}

function ChatBubble({ message }: { message: AiChatMessage }) {
  const isUser = message.role === "user";
  return <div className={isUser ? "flex justify-end" : "flex gap-3"}>{!isUser && <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-pink-100 text-pink-700"><Bot className="size-4" /></span>}<div className={isUser ? "max-w-[82%] rounded-2xl rounded-br-md bg-zinc-950 px-4 py-3 text-sm leading-6 text-white" : "min-w-0 max-w-full flex-1 text-sm leading-6 text-zinc-700"}><p>{message.text}</p>{message.components?.map((component, index) => <GenerativeComponent key={`${component.type}-${index}`} component={component} />)}</div></div>;
}

function GenerativeComponent({ component }: { component: AiComponent }) {
  if (component.type === "product_grid") {
    const items = Array.isArray(component.data.items) ? component.data.items as ProductShape[] : [];
    return <div className="mt-4 grid gap-3 sm:grid-cols-2">{items.slice(0, 8).map((item, index) => <AiProductCard key={String(item.id ?? item._id ?? index)} product={item} />)}{items.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500">No exact products yet. Try relaxing one filter.</div>}</div>;
  }
  if (component.type === "filter_summary") {
    const chips = flattenChips(component.data);
    return <div className="mt-3 flex flex-wrap gap-1.5">{chips.map((chip) => <span key={chip} className="rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-[10px] font-bold text-pink-800">{chip}</span>)}</div>;
  }
  if (component.type === "profile_proposal") {
    return <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-black text-violet-900">Save this style for later</p><p className="mt-1 text-[11px] text-violet-700">Nothing has been saved yet. Review these preferences before adding them to your profile.</p><Link href="/account/profile" className="mt-3 inline-flex items-center gap-1 text-xs font-black text-violet-900">Review choices <ArrowRight className="size-3" /></Link></div>;
  }
  return null;
}

function AiProductCard({ product }: { product: ProductShape }) {
  const slug = stringValue(product.slug, product.id, product._id);
  const title = stringValue(product.title, product.name, "StylMe product");
  const brand = stringValue(product.brand, (product.brand as Record<string, unknown> | undefined)?.name);
  const image = stringValue(product.coverImageUrl, product.imageUrl, product.image_url, firstImage(product.media), firstImage(product.images), firstImage(product.gallery));
  const price = recordValue(product.price);
  const firstOffer = Array.isArray(product.offers) ? recordValue(product.offers[0]) : {};
  const pricePaise = numberValue(product.pricePaise, product.price_paise, product.salePricePaise, product.sale_price_paise, price.salePricePaise, price.sale_price_paise, firstOffer.salePricePaise, firstOffer.sale_price_paise);
  return <Link href={slug ? `/products/${encodeURIComponent(slug)}` : "/products"} className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"><div className="aspect-[4/5] overflow-hidden bg-zinc-100">{image ? <img src={image} alt={title} loading="lazy" decoding="async" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="grid size-full place-items-center text-zinc-300"><Search className="size-6" /></div>}</div><div className="p-3"><p className="text-[10px] font-black uppercase tracking-wider text-pink-600">{brand || "StylMe"}</p><p className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-zinc-900">{title}</p>{pricePaise > 0 && <p className="mt-1 text-xs font-black text-zinc-950">{formatInr(pricePaise)}</p>}</div></Link>;
}

function PlanPanel({ plan }: { plan: AiSearchPlan | null }) {
  const groups = useMemo(() => plan ? [
    ["Shopping for", plan.gender], ["Category", plan.category], ["Product type", plan.productType], ["Brands", plan.brand], ["Colours", plan.colour], ["Sizes", plan.size],
  ] as Array<[string, string[]]> : [], [plan]);
  if (!plan) return <div className="mt-5 rounded-2xl border border-dashed border-zinc-200 p-5 text-center text-xs leading-5 text-zinc-400">The details we understood will appear here after your first message.</div>;
  return <div className="mt-5 space-y-4">{groups.filter(([, values]) => values.length).map(([label, values]) => <div key={label}><p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{label}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{values.map((value) => <span key={value} className="rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700">{value}</span>)}</div></div>)}{(plan.minPrice !== null || plan.maxPrice !== null) && <div><p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Price</p><p className="mt-1 text-xs font-bold text-zinc-800">₹{plan.minPrice ?? 0} – {plan.maxPrice ? `₹${plan.maxPrice}` : "Any"}</p></div>}{plan.swoopstyl && <div className="rounded-xl bg-pink-600 p-3 text-white"><p className="text-xs font-black">SwoopStyl · {plan.pincode}</p><p className="mt-1 text-[10px] text-pink-100">Fastest available styles are shown first</p></div>}</div>;
}

function flattenChips(data: Record<string, unknown>): string[] {
  const chips: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) value.forEach((item) => { if (typeof item === "string" && item) chips.push(`${titleCase(key)} · ${item}`); });
  }
  return chips.slice(0, 12);
}

function titleCase(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function stringValue(...values: unknown[]) { for (const value of values) if (typeof value === "string" && value.trim()) return value.trim(); return ""; }
function numberValue(...values: unknown[]) { for (const value of values) { const parsed = Number(value); if (Number.isFinite(parsed) && parsed > 0) return parsed; } return 0; }
function recordValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function firstImage(value: unknown) { if (!Array.isArray(value) || value.length === 0) return ""; const first = value[0]; if (typeof first === "string") return first; const image = recordValue(first); return stringValue(image.displayUrl, image.display_url, image.url, image.imageUrl, image.image_url); }

function buildSearchHref(queryParams: Record<string, unknown> | null, plan: AiSearchPlan | null, fallbackText: string) {
  const params = new URLSearchParams();
  if (queryParams) {
    for (const [key, raw] of Object.entries(queryParams)) {
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (["string", "number", "boolean"].includes(typeof value) && value !== "") params.append(key, String(value));
      }
    }
  } else if (plan) {
    if (fallbackText) params.set("q", fallbackText);
    if (plan.lexicalQuery) params.set("lexical", plan.lexicalQuery);
    plan.brand.forEach((value) => params.append("brand", value));
    plan.category.forEach((value) => params.append("category", value));
    plan.productType.forEach((value) => params.append("productType", value));
    plan.colour.forEach((value) => params.append("colour", value));
    plan.size.forEach((value) => params.append("size", value));
    plan.gender.forEach((value) => params.append("gender", value));
    Object.entries(plan.metadata).forEach(([key, values]) => values.forEach((value) => params.append("meta", `${key}:${value}`)));
    if (plan.minPrice !== null) params.set("minPrice", String(plan.minPrice));
    if (plan.maxPrice !== null) params.set("maxPrice", String(plan.maxPrice));
    if (plan.sort) params.set("sort", plan.sort);
    if (plan.swoopstyl) params.set("swoopstyl", "true");
    if (plan.pincode) params.set("pincode", plan.pincode);
    params.set("intent", "1");
    params.set("intentSource", "stylme-web-agent");
  }
  return params.size ? `/search?${params.toString()}` : "";
}
