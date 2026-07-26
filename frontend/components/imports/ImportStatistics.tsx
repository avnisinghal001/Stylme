import { CheckCircle2, CircleSlash2, SkipForward, XCircle } from 'lucide-react';

interface ImportStatisticsProps {
  total: number;
  imported: number;
  successful: number;
  rejected: number;
  skipped: number;
}

export function ImportStatistics({ total, imported, successful, rejected, skipped }: ImportStatisticsProps) {
  const items = [
    { label: 'Total imported', value: imported, icon: CircleSlash2, className: 'text-blue-600' }, { label: 'Successful', value: successful, icon: CheckCircle2, className: 'text-emerald-600' },
    { label: 'Rejected', value: rejected, icon: XCircle, className: 'text-rose-600' }, { label: 'Skipped', value: skipped, icon: SkipForward, className: 'text-amber-600' },
  ];
  const completion = Math.round((imported / total) * 100);

  return <section className="rounded-xl border bg-card p-5"><h2 className="text-base font-semibold text-foreground">Import statistics</h2><p className="mt-1 text-sm text-muted-foreground">Current run breakdown.</p><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">{items.map(({ label, value, icon: Icon, className }) => <div key={label} className="flex items-center gap-3 rounded-lg bg-muted/40 p-3"><Icon className={`size-5 ${className}`} /><div><p className="text-lg font-semibold text-foreground">{value.toLocaleString('en-IN')}</p><p className="text-xs text-muted-foreground">{label}</p></div></div>)}</div><div className="mt-5 border-t pt-4"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Completion</span><span className="font-medium text-foreground">{completion}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${completion}%` }} /></div></div></section>;
}
