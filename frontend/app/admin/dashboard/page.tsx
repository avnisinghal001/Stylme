'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle2,
  CircleGauge,
  Clock3,
  ImageOff,
  Layers3,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  UploadCloud,
  Users,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import QuickAction from '@/components/dashboard/QuickAction';
import RecentActivity from '@/components/dashboard/RecentActivity';
import StatCard from '@/components/dashboard/StatCard';
import { getDashboardStats } from '@/lib/api/dashboard';
import { useAuth } from '@/providers/AuthProvider';
import type { DashboardDistributionItem, DashboardStats } from '@/types/dashboard';

const numberFormatter = new Intl.NumberFormat('en-IN');

const statusPalette: Record<string, string> = {
  active: 'bg-emerald-500',
  approved: 'bg-emerald-500',
  pending: 'bg-amber-400',
  pending_review: 'bg-amber-400',
  rejected: 'bg-rose-500',
  draft: 'bg-zinc-300',
  inactive: 'bg-zinc-400',
};

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function percentage(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function formatPercent(value: number) {
  if (value === 0) return '0%';
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatUpdatedAt(value: string | null) {
  if (!value) return 'Updated just now';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Updated just now';
  return `Updated ${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(date)}`;
}

function topCategories(items: DashboardDistributionItem[]) {
  const visible = items.slice(0, 5);
  const otherCount = items.slice(5).reduce((sum, item) => sum + item.count, 0);
  return otherCount > 0 ? [...visible, { name: 'Other', count: otherCount }] : visible;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const loadDashboard = useCallback(async (signal?: AbortSignal, isRefresh = false) => {
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const data = await getDashboardStats(signal);
      setStats(data);
      setFetchedAt(new Date().toISOString());
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'The dashboard could not be loaded.');
    } finally {
      if (isRefresh) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getDashboardStats(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setStats(data);
      setFetchedAt(new Date().toISOString());
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'The dashboard could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, []);

  const categoryItems = useMemo(() => topCategories(stats?.categoryDistribution ?? []), [stats?.categoryDistribution]);

  if (isLoading && !stats) return <DashboardSkeleton />;

  if (!stats) {
    return (
      <section className="grid min-h-[30rem] place-items-center rounded-3xl border border-rose-200 bg-rose-50/70 p-6 text-center">
        <div className="max-w-md">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-rose-600 shadow-sm"><AlertCircle className="size-6" /></span>
          <h1 className="mt-4 text-xl font-black text-zinc-950">Dashboard data is unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">{error ?? 'We could not build the operational snapshot.'}</p>
          <button type="button" onClick={() => void loadDashboard()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2">
            <RefreshCw className="size-4" /> Try again
          </button>
        </div>
      </section>
    );
  }

  const activeRate = percentage(stats.products.active, stats.products.total);
  const sellerApprovalRate = percentage(stats.sellers.approved, stats.sellers.total);
  const attentionTotal = stats.products.pendingReview + stats.products.rejected + stats.products.missingImages + stats.sellers.pending;
  const distributionTotal = stats.categoryDistribution.reduce((sum, item) => sum + item.count, 0);
  const statusTotal = stats.statusDistribution.reduce((sum, item) => sum + item.count, 0);
  const updatedAt = stats.generatedAt ?? fetchedAt;

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-3xl border border-pink-100 bg-[radial-gradient(circle_at_top_right,rgba(255,63,108,0.13),transparent_36%),linear-gradient(135deg,#fff_0%,#fff8fa_100%)] p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500" /> Live operations</span>
              <span className="text-xs font-medium text-zinc-500">{formatUpdatedAt(updatedAt)}</span>
            </div>
            <h1 className="mt-4 text-2xl font-black tracking-[-0.035em] text-zinc-950 sm:text-4xl">Good to see you, {user?.fullName?.split(' ')[0] ?? 'team'}.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 sm:text-base">Start with the queues that need a decision, then monitor catalogue and marketplace health.</p>
          </div>
          <button type="button" onClick={() => void loadDashboard(undefined, true)} disabled={isRefreshing} className="inline-flex h-10 w-fit items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-800 shadow-sm transition hover:border-pink-200 hover:text-pink-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2">
            <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} /> {isRefreshing ? 'Refreshing' : 'Refresh data'}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <p><strong>Showing the last available snapshot.</strong> {error}</p>
          <button type="button" onClick={() => void loadDashboard(undefined, true)} className="w-fit font-bold underline underline-offset-4">Retry</button>
        </div>
      )}

      {stats.isPartial && (
        <div role="status" className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <p><strong>Some dashboard sources are still syncing.</strong> Available metrics are shown; missing values are safely displayed as zero.</p>
        </div>
      )}

      <section aria-labelledby="radar-title">
        <SectionHeading eyebrow="Current snapshot" title="Operations radar" description="A compact view of marketplace scale and health. Percentages use the latest available totals." id="radar-title" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Catalogue" value={formatNumber(stats.products.total)} detail={`${formatNumber(stats.products.active)} active · ${formatPercent(activeRate)} health`} progress={activeRate} tone="positive" href="/admin/products" icon={<PackageCheck />} />
          <StatCard title="Sellers" value={formatNumber(stats.sellers.total)} detail={`${formatNumber(stats.sellers.approved)} approved · ${formatNumber(stats.sellers.pending)} pending`} progress={sellerApprovalRate} tone={stats.sellers.pending > 0 ? 'warning' : 'positive'} href="/admin/sellers" icon={<Store />} />
          <StatCard title="Active offers" value={formatNumber(stats.totalOffers)} detail="Live seller listings across the catalogue" href="/admin/products" icon={<Sparkles />} />
          <StatCard title="Taxonomy" value={formatNumber(stats.brands)} detail={`${stats.averageRating.toFixed(1)} average rating · active brands`} href="/admin/taxonomy" icon={<Layers3 />} />
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <AttentionPanel stats={stats} total={attentionTotal} />
        <RecentActivity activities={stats.recentActivity} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <CategoryMix items={categoryItems} total={distributionTotal} />
        <StatusMix items={stats.statusDistribution} total={statusTotal} />
      </div>

      <section aria-labelledby="quick-actions-title">
        <SectionHeading eyebrow="Shortcuts" title="Keep work moving" description="Jump directly into common catalogue and marketplace workflows." id="quick-actions-title" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction href="/admin/upload" title="Add product" subtitle="Images, variants and one-shot AI" icon={<UploadCloud />} />
          <QuickAction href="/admin/products" title="Review catalogue" subtitle="Browse canonical products" icon={<Box />} />
          <QuickAction href="/admin/sellers" title="Seller approvals" subtitle="Review marketplace access" icon={<Users />} />
          <QuickAction href="/admin/taxonomy" title="Controlled taxonomy" subtitle="Manage reusable metadata" icon={<Layers3 />} />
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description: string; id: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-pink-600">{eyebrow}</p>
      <h2 id={id} className="mt-1 text-xl font-black tracking-tight text-zinc-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  );
}

function AttentionPanel({ stats, total }: { stats: DashboardStats; total: number }) {
  return (
    <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(24,24,27,0.45)] sm:p-6" aria-labelledby="attention-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-pink-600">Priority queue</p>
          <h2 id="attention-title" className="mt-1 text-xl font-black tracking-tight text-zinc-950">Needs attention</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">Resolve approval and quality blockers before routine catalogue work.</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-black ${total > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{total > 0 ? `${formatNumber(total)} open` : 'All clear'}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <QueueItem href="/admin/products" label="Pending review" detail="Awaiting a catalogue decision" value={stats.products.pendingReview} icon={<Clock3 />} tone="warning" />
        <QueueItem href="/admin/products" label="Missing images" detail="Incomplete product presentation" value={stats.products.missingImages} icon={<ImageOff />} tone="critical" />
        <QueueItem href="/admin/rejected" label="Rejected products" detail="Returned for seller correction" value={stats.products.rejected} icon={<XCircle />} tone="critical" />
        <QueueItem href="/admin/sellers" label="Seller approvals" detail="Marketplace access waiting" value={stats.sellers.pending} icon={<ShieldCheck />} tone="warning" />
      </div>
    </section>
  );
}

function QueueItem({ href, label, detail, value, icon, tone }: { href: string; label: string; detail: string; value: number; icon: ReactNode; tone: 'warning' | 'critical' }) {
  const isClear = value === 0;
  const palette = isClear
    ? 'border-zinc-200 bg-zinc-50 text-zinc-500'
    : tone === 'critical'
      ? 'border-rose-200 bg-rose-50/70 text-rose-700'
      : 'border-amber-200 bg-amber-50/70 text-amber-700';

  return (
    <Link href={href} className={`group flex min-w-0 items-center gap-3 rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 ${palette}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/80 [&>svg]:size-5">{isClear ? <CheckCircle2 className="text-emerald-600" /> : icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-zinc-950">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-500">{isClear ? 'No open items' : detail}</span>
      </span>
      <span className="text-lg font-black tabular-nums">{formatNumber(value)}</span>
      <ArrowRight className="size-4 shrink-0 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function CategoryMix({ items, total }: { items: DashboardDistributionItem[]; total: number }) {
  return (
    <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(24,24,27,0.45)] sm:p-6" aria-labelledby="category-mix-title">
      <SectionHeading eyebrow="Catalogue mix" title="Top categories" description="Share of active products by primary category, with the long tail grouped as Other." id="category-mix-title" />
      {items.length === 0 ? <EmptyData message="Category data will appear after products are classified." /> : (
        <div className="mt-5 space-y-4">
          {items.map((item, index) => {
            const share = percentage(item.count, total);
            return (
              <div key={item.name}>
                <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
                  <span className="truncate font-bold text-zinc-800">{titleCase(item.name)}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500"><strong className="text-zinc-900">{formatNumber(item.count)}</strong> · {formatPercent(share)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`${titleCase(item.name)}: ${formatNumber(item.count)}, ${formatPercent(share)}`}>
                  <div className={`h-full rounded-full ${index === 0 ? 'bg-pink-500' : index === 1 ? 'bg-pink-400' : 'bg-pink-300'}`} style={{ width: `${share}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusMix({ items, total }: { items: DashboardDistributionItem[]; total: number }) {
  return (
    <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(24,24,27,0.45)] sm:p-6" aria-labelledby="status-mix-title">
      <SectionHeading eyebrow="Quality state" title="Product status" description="A labelled view of every catalogue state—no hover required." id="status-mix-title" />
      {items.length === 0 ? <EmptyData message="Status data will appear after catalogue processing begins." /> : (
        <>
          <div className="mt-6 flex h-4 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`Product status distribution across ${formatNumber(total)} products`}>
            {items.map((item) => <div key={item.name} className={statusPalette[item.name.toLowerCase()] ?? 'bg-pink-400'} style={{ width: `${percentage(item.count, total)}%` }} title={`${titleCase(item.name)}: ${formatNumber(item.count)}`} />)}
          </div>
          <div className="mt-5 divide-y divide-zinc-100">
            {items.map((item) => {
              const share = percentage(item.count, total);
              return (
                <div key={item.name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={`size-2.5 rounded-full ${statusPalette[item.name.toLowerCase()] ?? 'bg-pink-400'}`} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-800">{titleCase(item.name)}</span>
                  <span className="text-sm font-black tabular-nums text-zinc-950">{formatNumber(item.count)}</span>
                  <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{formatPercent(share)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
            <span>Total classified</span><strong className="text-sm tabular-nums text-zinc-900">{formatNumber(total)}</strong>
          </div>
        </>
      )}
    </section>
  );
}

function EmptyData({ message }: { message: string }) {
  return <div className="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-6 text-center text-sm text-zinc-500"><div><CircleGauge className="mx-auto size-7 text-zinc-300" /><p className="mt-3 max-w-xs leading-6">{message}</p></div></div>;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading dashboard" aria-busy="true">
      <div className="h-48 animate-pulse rounded-3xl bg-zinc-100" />
      <div className="space-y-3"><div className="h-4 w-32 animate-pulse rounded bg-zinc-100" /><div className="h-7 w-56 animate-pulse rounded bg-zinc-100" /></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl bg-zinc-100" />)}</div>
      <div className="grid gap-5 xl:grid-cols-2"><div className="h-96 animate-pulse rounded-3xl bg-zinc-100" /><div className="h-96 animate-pulse rounded-3xl bg-zinc-100" /></div>
      <span className="sr-only">Loading dashboard data</span>
    </div>
  );
}
