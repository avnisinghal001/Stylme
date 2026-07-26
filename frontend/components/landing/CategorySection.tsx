import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const accents = [
  "from-pink-500 to-rose-700",
  "from-zinc-800 to-zinc-950",
  "from-orange-400 to-rose-600",
  "from-fuchsia-500 to-pink-700",
  "from-amber-400 to-orange-600",
  "from-rose-400 to-pink-600",
];

export function CategorySection({ categories }: { categories: string[] }) {
  const values = categories.length ? categories.slice(0, 6) : ["Women", "Men", "Footwear", "Beauty", "Kids", "Home"];
  return (
    <section className="mx-auto w-full max-w-[90rem] px-4 sm:px-6">
      <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-pink-600">Shop your way</p><h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Explore by category</h2></div><Link href="/products" className="hidden items-center gap-1 text-sm font-bold text-pink-700 sm:flex">View everything <ArrowUpRight className="size-4" /></Link></div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6 sm:gap-4">
        {values.map((category, index) => <Link key={category} href={`/products?category=${encodeURIComponent(category)}`} className={`group relative flex aspect-square flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br ${accents[index % accents.length]} p-3 text-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl sm:p-4`}><span className="absolute -bottom-8 -right-8 size-24 rounded-full bg-white/15 transition-transform group-hover:scale-125" /><span className="grid size-7 place-items-center self-end rounded-full bg-white/15 backdrop-blur"><ArrowUpRight className="size-3.5" /></span><span className="relative text-xs font-black sm:text-sm">{category}</span></Link>)}
      </div>
    </section>
  );
}
