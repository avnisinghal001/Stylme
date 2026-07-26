import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

type Tone = 'neutral' | 'positive' | 'warning' | 'critical';

type Props = {
  title: string;
  value: string | number;
  icon: ReactNode;
  detail: string;
  href?: string;
  progress?: number;
  tone?: Tone;
};

const tones: Record<Tone, { icon: string; bar: string; value: string }> = {
  neutral: { icon: 'bg-zinc-100 text-zinc-700', bar: 'bg-zinc-800', value: 'text-zinc-950' },
  positive: { icon: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500', value: 'text-emerald-950' },
  warning: { icon: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500', value: 'text-amber-950' },
  critical: { icon: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500', value: 'text-rose-950' },
};

export default function StatCard({ title, value, icon, detail, href, progress, tone = 'neutral' }: Props) {
  const palette = tones[tone];
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.09em] text-zinc-500">{title}</p>
          <p className={`mt-2 text-2xl font-black tracking-[-0.035em] sm:text-3xl ${palette.value}`}>{value}</p>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-2xl [&>svg]:size-5 ${palette.icon}`}>{icon}</span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-xs leading-5 text-zinc-500">{detail}</p>
        {href && <ArrowUpRight className="size-4 shrink-0 text-zinc-400 transition group-hover:text-pink-600" />}
      </div>
      {progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-label={`${title}: ${Math.round(progress)} percent`} role="img">
          <div className={`h-full rounded-full ${palette.bar}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </>
  );

  const className = "group block min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_10px_30px_-26px_rgba(24,24,27,0.45)] transition hover:border-pink-200 hover:shadow-[0_18px_36px_-28px_rgba(190,24,93,0.5)] sm:p-5";
  return href ? <Link href={href} className={className}>{content}</Link> : <article className={className}>{content}</article>;
}
