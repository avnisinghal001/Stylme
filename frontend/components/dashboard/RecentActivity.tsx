import { Activity, CheckCircle2, Clock3, LogIn, PackageCheck, Send, Store, UserRoundCheck, XCircle } from 'lucide-react';

import type { DashboardActivity } from '@/types/dashboard';

const actionCopy: Record<string, string> = {
  product_draft_created: 'Product draft created',
  product_draft_updated: 'Product draft updated',
  product_draft_submitted: 'Product submitted for review',
  product_draft_approved: 'Product approved',
  product_draft_rejected: 'Product rejected',
  seller_applied: 'Seller application received',
  seller_approved: 'Seller approved',
  seller_rejected: 'Seller rejected',
  ai_processing_completed: 'AI proposal completed',
  ai_processing_failed: 'AI proposal failed',
  auth_login: 'Workspace sign-in',
  profile_updated: 'Customer profile updated',
};

function titleCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeTime(value: string | null) {
  if (!value) return 'Time unavailable';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Time unavailable';
  const seconds = Math.round((timestamp - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(timestamp));
}

function activityStyle(action: string) {
  if (action.includes('approved') || action.includes('completed')) return { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700' };
  if (action.includes('rejected') || action.includes('failed')) return { icon: XCircle, className: 'bg-rose-50 text-rose-700' };
  if (action.includes('submitted')) return { icon: Send, className: 'bg-blue-50 text-blue-700' };
  if (action.includes('seller')) return { icon: UserRoundCheck, className: 'bg-violet-50 text-violet-700' };
  if (action === 'auth_login') return { icon: LogIn, className: 'bg-zinc-100 text-zinc-700' };
  if (action.includes('product')) return { icon: PackageCheck, className: 'bg-pink-50 text-pink-700' };
  return { icon: Activity, className: 'bg-amber-50 text-amber-700' };
}

export default function RecentActivity({ activities }: { activities: DashboardActivity[] }) {
  return (
    <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_50px_-40px_rgba(24,24,27,0.45)] sm:p-6" aria-labelledby="recent-activity-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-pink-600">Live log</p>
          <h2 id="recent-activity-title" className="mt-1 text-xl font-black tracking-tight text-zinc-950">Recent activity</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Latest role-verified changes across the workspace.</p>
        </div>
        <Clock3 className="size-5 text-zinc-400" />
      </div>

      {activities.length === 0 ? (
        <div className="mt-5 grid min-h-56 place-items-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-6 text-center">
          <div><Store className="mx-auto size-7 text-zinc-300" /><p className="mt-3 text-sm font-bold text-zinc-700">No activity yet</p><p className="mt-1 text-xs leading-5 text-zinc-500">Approvals, catalogue edits, and seller updates will appear here.</p></div>
        </div>
      ) : (
        <ol className="mt-5 divide-y divide-zinc-100">
          {activities.slice(0, 7).map((item) => {
            const style = activityStyle(item.action);
            const Icon = style.icon;
            const entity = item.entityType ? titleCase(item.entityType) : 'Workspace';
            return (
              <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${style.className}`}><Icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-5 text-zinc-900">{actionCopy[item.action] ?? titleCase(item.action || 'Workspace updated')}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">{entity}{item.entityId ? ` · ${item.entityId}` : ''}{item.actorRole ? ` · ${titleCase(item.actorRole)}` : ''}</p>
                </div>
                <time dateTime={item.createdAt ?? undefined} className="shrink-0 pt-0.5 text-[11px] font-medium text-zinc-400">{relativeTime(item.createdAt)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
