"use client";

import { ClipboardList, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { StorefrontFooter } from "@/components/storefront/StorefrontFooter";
import { StorefrontNavbar } from "@/components/storefront/StorefrontNavbar";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute roles={["customer", "owner", "admin", "seller"]}><div className="flex min-h-dvh flex-col bg-[#fffafa]"><StorefrontNavbar /><div className="mx-auto grid w-full max-w-[90rem] flex-1 gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-10"><aside className="h-fit rounded-2xl border border-pink-100 bg-white p-3 shadow-sm lg:sticky lg:top-24"><p className="px-3 py-2 text-[10px] font-black uppercase tracking-[.18em] text-pink-600">My StylMe</p><nav className="grid gap-1"><AccountLink href="/account/profile" icon={<UserRound className="size-4" />} label="Profile" /><AccountLink href="/account/onboarding" icon={<Sparkles className="size-4" />} label="Style onboarding" /><AccountLink href="/account/cart" icon={<ShoppingBag className="size-4" />} label="Cart" /><AccountLink href="/account/orders" icon={<ClipboardList className="size-4" />} label="Orders" /></nav></aside><main className="min-w-0">{children}</main></div><StorefrontFooter /></div></ProtectedRoute>;
}

function AccountLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <Link href={href} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-pink-50 hover:text-pink-700">{icon}{label}</Link>;
}
