import { CheckCircle2, CircleAlert, CircleDashed, TriangleAlert } from 'lucide-react';

export interface ImportLog {
  id: string;
  message: string;
  time: string;
  status: 'success' | 'error' | 'warning' | 'processing';
}

const statusContent = {
  success: { icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' }, error: { icon: CircleAlert, tone: 'bg-rose-50 text-rose-600' },
  warning: { icon: TriangleAlert, tone: 'bg-amber-50 text-amber-600' }, processing: { icon: CircleDashed, tone: 'bg-blue-50 text-blue-600' },
};

export function ImportLogs({ logs }: { logs: ImportLog[] }) {
  return <section className="rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-base font-semibold text-foreground">Live logs</h2><p className="mt-1 text-sm text-muted-foreground">Static preview of recent import events.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{logs.length} events</span></div><ol className="divide-y px-5">{logs.map((log) => { const { icon: Icon, tone } = statusContent[log.status]; return <li key={log.id} className="flex gap-3 py-4"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${tone}`}><Icon className={`size-4 ${log.status === 'processing' ? 'animate-spin' : ''}`} /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground">{log.message}</p><p className="mt-1 text-xs text-muted-foreground">{log.time}</p></div></li>; })}</ol></section>;
}
