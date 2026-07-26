import { Clock3, FileSpreadsheet, History } from 'lucide-react';

import type { ImportRecord } from '@/types/upload';

interface CurrentImport {
  id: string;
  fileName: string;
  status: string;
  total: number;
  imported: number;
  successful: number;
  rejected: number;
  skipped: number;
  remainingTime: string;
}

export function ImportOverview({ currentImport, recentImports }: { currentImport: CurrentImport; recentImports: ImportRecord[] }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileSpreadsheet className="size-5" /></span><div><p className="text-sm font-medium text-muted-foreground">Current import</p><h2 className="mt-1 text-lg font-semibold text-foreground">{currentImport.fileName}</h2><p className="mt-1 text-sm text-muted-foreground">Import ID: {currentImport.id}</p></div></div>
        <div className="flex items-center gap-2 text-sm"><Clock3 className="size-4 text-muted-foreground" /><span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">{currentImport.status}</span><span className="text-muted-foreground">{currentImport.remainingTime} remaining</span></div>
      </div>
      <div className="mt-5 border-t pt-5"><div className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Recent imports</h3></div><div className="mt-3 grid gap-2 md:grid-cols-3">{recentImports.slice(0, 3).map((item) => <div key={item.id} className="rounded-lg bg-muted/50 p-3"><p className="truncate text-sm font-medium text-foreground">{item.fileName}</p><p className="mt-1 text-xs text-muted-foreground">{item.importedRows.toLocaleString('en-IN')} imported · {item.status}</p></div>)}</div></div>
    </section>
  );
}
