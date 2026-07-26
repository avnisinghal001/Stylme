import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

type Props = {
  title: string;
  subtitle: string;
  icon: ReactNode;
  href: string;
};

export default function QuickAction({ title, subtitle, icon, href }: Props) {
  return (
    <Link href={href} className="group flex min-h-28 items-start gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 transition hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-[0_16px_34px_-28px_rgba(190,24,93,0.65)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-pink-50 text-pink-600 transition group-hover:bg-pink-600 group-hover:text-white [&>svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-zinc-950">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-zinc-500">{subtitle}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-zinc-400 transition group-hover:text-pink-600" />
    </Link>
  );
}
