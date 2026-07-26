import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProductCard } from "@/components/catalog/ProductCard";
import type { CatalogProduct } from "@/types/catalog";

export function ProductSection({ eyebrow, title, description, products, href = "/products", tinted = false }: { eyebrow: string; title: string; description: string; products: CatalogProduct[]; href?: string; tinted?: boolean }) {
  if (!products.length) return null;
  const content = <><div className="mb-6 flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-pink-600">{eyebrow}</p><h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">{title}</h2><p className="mt-1 max-w-xl text-sm text-zinc-500">{description}</p></div><Link href={href} className="hidden shrink-0 items-center gap-1 rounded-full border border-pink-200 px-4 py-2 text-sm font-bold text-pink-700 transition hover:bg-pink-600 hover:text-white sm:flex">View all <ArrowRight className="size-4" /></Link></div><div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{products.slice(0, 8).map((product) => <ProductCard key={product.id} product={product} compact />)}</div></>;
  return tinted ? <section className="mx-auto w-full max-w-[90rem] px-4 sm:px-6"><div className="rounded-[2rem] border border-pink-100 bg-gradient-to-b from-pink-50/80 to-white p-5 sm:p-8">{content}</div></section> : <section className="mx-auto w-full max-w-[90rem] px-4 sm:px-6">{content}</section>;
}
