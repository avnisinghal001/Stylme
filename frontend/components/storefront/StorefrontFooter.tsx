import Link from "next/link";
import { Camera, Mail, Sparkles, Zap } from "lucide-react";

const footerColumns = [
  { title: "Shop", links: [["New arrivals", "/products?sort=newest"], ["Women", "/products?gender=women"], ["Men", "/products?gender=men"], ["Footwear", "/products?category=footwear"]] },
  { title: "StylMe", links: [["SwoopStyl delivery", "/search?q=swoopstyl"], ["Style search", "/search"], ["Seller portal", "/admin"], ["About the project", "/#story"]] },
  { title: "Help", links: [["Contact", "mailto:hello@stylme.in"], ["Shipping", "/#delivery"], ["Returns", "/#returns"], ["Privacy", "/#privacy"]] },
] as const;

export function StorefrontFooter() {
  return (
    <footer className="mt-16 px-4 pb-6 sm:px-6">
      <div className="mx-auto max-w-[90rem] overflow-hidden rounded-[2rem] border border-pink-100 bg-gradient-to-br from-pink-50 via-white to-rose-50">
        <div className="grid gap-10 p-8 sm:p-10 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2"><span className="grid size-9 place-items-center rounded-full bg-pink-600 text-white"><Sparkles className="size-4" /></span><span className="text-2xl font-black tracking-tight">StylMe</span></Link>
            <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-600">Fashion discovery that understands your words, your fit and what can reach you fastest.</p>
            <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-bold text-pink-700 shadow-sm"><Zap className="size-3.5 fill-pink-600" /> SwoopStyl · nearby fashion in one day</span>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {footerColumns.map((column) => <div key={column.title}><h2 className="text-xs font-black uppercase tracking-[0.16em] text-zinc-900">{column.title}</h2><ul className="mt-4 space-y-3">{column.links.map(([label, href]) => <li key={label}><Link href={href} className="text-sm text-zinc-600 transition hover:text-pink-700">{label}</Link></li>)}</ul></div>)}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-pink-100 px-8 py-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} StylMe. Built for Myntra HackerRamp.</span>
          <div className="flex items-center gap-2"><a href="mailto:hello@stylme.in" aria-label="Email StylMe" className="grid size-8 place-items-center rounded-full bg-white hover:text-pink-700"><Mail className="size-4" /></a><a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="StylMe on Instagram" className="grid size-8 place-items-center rounded-full bg-white hover:text-pink-700"><Camera className="size-4" /></a></div>
        </div>
      </div>
    </footer>
  );
}
