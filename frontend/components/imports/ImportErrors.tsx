import { AlertTriangle, CircleAlert } from 'lucide-react';

export interface ImportError {
  id: string;
  issue: string;
  detail: string;
  severity: 'warning' | 'error';
}

export function ImportErrors({ errors }: { errors: ImportError[] }) {
  return <section className="rounded-xl border bg-card"><div className="flex items-center gap-2 border-b px-5 py-4"><AlertTriangle className="size-4 text-amber-600" /><div><h2 className="text-base font-semibold text-foreground">Import errors</h2><p className="mt-1 text-sm text-muted-foreground">Rows that need attention before the next import.</p></div></div><div className="divide-y">{errors.map((error) => <div key={error.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><CircleAlert className={`mt-0.5 size-4 ${error.severity === 'error' ? 'text-rose-600' : 'text-amber-600'}`} /><div><p className="text-sm font-medium text-foreground">{error.id} · {error.issue}</p><p className="mt-1 text-sm text-muted-foreground">{error.detail}</p></div></div><span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${error.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{error.severity}</span></div>)}</div></section>;
}
