import { MapPin, SearchCheck, ShieldCheck, Sparkles } from "lucide-react";

const promises = [
  [SearchCheck, "Search your way", "Describe a mood, occasion, city, activity or budget."],
  [MapPin, "Fastest delivery first", "See nearby one-day styles when SwoopStyl is on."],
  [Sparkles, "Made for your fit", "Your saved preferences bring better matches forward."],
  [ShieldCheck, "Real product details", "Prices, sizes and availability come from live listings."],
] as const;

export function PromiseStrip() {
  return <section id="story" className="mx-auto w-full max-w-[90rem] px-4 sm:px-6"><div className="grid gap-px overflow-hidden rounded-[2rem] border border-pink-100 bg-pink-100 sm:grid-cols-2 lg:grid-cols-4">{promises.map(([Icon, title, copy]) => <div key={title} className="bg-white p-5"><span className="grid size-9 place-items-center rounded-xl bg-pink-50 text-pink-600"><Icon className="size-4" /></span><h2 className="mt-3 text-sm font-black text-zinc-900">{title}</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{copy}</p></div>)}</div></section>;
}
