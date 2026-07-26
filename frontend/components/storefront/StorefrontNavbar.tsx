"use client";

import Link from "next/link";
import { useState } from "react";
import { Heart, Menu, Search, ShoppingBag, Sparkles, UserRound, X } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { ProfileSearchSignals } from "@/components/storefront/ProfileSearchSignals";

const links = [
  { href: "/products?gender=women", label: "Women" },
  { href: "/products?gender=men", label: "Men" },
  { href: "/products?category=footwear", label: "Footwear" },
  { href: "/products?meta=theme%3Afestive", label: "Festive" },
];

export function StorefrontNavbar() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-pink-100/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[90rem] items-center gap-3 px-4 sm:px-6">
        <button type="button" onClick={() => setOpen((current) => !current)} className="grid size-10 place-items-center rounded-full text-zinc-700 transition hover:bg-pink-50 md:hidden" aria-expanded={open} aria-controls="mobile-store-nav" aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2" aria-label="StylMe home">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-rose-700 text-white shadow-[0_8px_24px_-10px_rgba(255,63,108,0.8)]"><Sparkles className="size-4" /></span>
          <span className="text-xl font-black tracking-[-0.04em] text-zinc-950">Styl<span className="text-pink-600">Me</span></span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          {links.map((link) => <Link key={link.href} href={link.href} className="rounded-full px-3 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-pink-50 hover:text-pink-700">{link.label}</Link>)}
        </nav>

        <form action="/search" className="ml-auto hidden h-10 min-w-52 max-w-md flex-1 items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 transition focus-within:border-pink-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-pink-100 lg:flex">
          <ProfileSearchSignals mode="intent" />
          <Search className="size-4 shrink-0 text-zinc-400" />
          <label htmlFor="desktop-catalog-search" className="sr-only">Search products</label>
          <input id="desktop-catalog-search" name="q" placeholder="Search styles, brands and occasions" className="min-w-0 flex-1 bg-transparent px-2 text-sm text-zinc-800 outline-none placeholder:text-zinc-400" />
          <button type="submit" className="text-xs font-bold text-pink-700">Search</button>
        </form>

        <div className="ml-auto flex items-center gap-0.5 lg:ml-0">
          <Link href="/search" aria-label="Search" className="grid size-10 place-items-center rounded-full text-zinc-700 transition hover:bg-pink-50 hover:text-pink-700 lg:hidden"><Search className="size-5" /></Link>
          <Link href={user ? (user.roles.includes("customer") ? "/account/profile" : "/admin/dashboard") : "/login"} aria-label="Account" className="hidden size-10 place-items-center rounded-full text-zinc-700 transition hover:bg-pink-50 hover:text-pink-700 sm:grid"><UserRound className="size-5" /></Link>
          <button type="button" aria-label="Wishlist" className="hidden size-10 place-items-center rounded-full text-zinc-700 transition hover:bg-pink-50 hover:text-pink-700 sm:grid"><Heart className="size-5" /></button>
          <Link href={user ? "/account/cart" : "/login"} aria-label="Shopping cart" className="relative grid size-10 place-items-center rounded-full text-zinc-700 transition hover:bg-pink-50 hover:text-pink-700"><ShoppingBag className="size-5" /></Link>
        </div>
      </div>

      {open && (
        <nav id="mobile-store-nav" aria-label="Mobile navigation" className="border-t border-pink-100 bg-white px-4 py-4 md:hidden">
          <form action="/search" className="mb-3 flex h-11 items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 focus-within:border-pink-400">
            <ProfileSearchSignals mode="intent" />
            <Search className="size-4 text-zinc-400" />
            <label htmlFor="mobile-catalog-search" className="sr-only">Search products</label>
            <input id="mobile-catalog-search" name="q" placeholder="What are you looking for?" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" />
          </form>
          <div className="grid grid-cols-2 gap-2">
            {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-xl bg-pink-50 px-4 py-3 text-sm font-semibold text-pink-800">{link.label}</Link>)}
          </div>
          <Link href={user ? "/account/profile" : "/login"} onClick={() => setOpen(false)} className="mt-2 block rounded-xl border border-pink-100 px-4 py-3 text-sm font-semibold text-zinc-700">{user ? "My profile" : "Log in / Sign up"}</Link>
        </nav>
      )}
    </header>
  );
}
