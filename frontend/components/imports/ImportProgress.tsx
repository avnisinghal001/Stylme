import { Clock3, LoaderCircle } from 'lucide-react';

interface ImportProgressProps {
  total: number;
  imported: number;
  remainingTime: string;
}

export function ImportProgress({ total, imported, remainingTime }: ImportProgressProps) {
  const progress = Math.round((imported / total) * 100);

  return <section className="rounded-xl border bg-card p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin text-primary" /><h2 className="text-base font-semibold text-foreground">Import progress</h2></div><p className="mt-1 text-sm text-muted-foreground">Processing product records and image references.</p></div><div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />Estimated time remaining: {remainingTime}</div></div><div className="mt-6 flex items-end justify-between"><div><p className="text-3xl font-semibold text-foreground">{progress}%</p><p className="mt-1 text-sm text-muted-foreground">{imported.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} products imported</p></div><p className="text-sm font-medium text-foreground">{(total - imported).toLocaleString('en-IN')} remaining</p></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div></section>;
}
