import { CheckCircle2, FileSpreadsheet, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function FilePreview({ fileName }: { fileName: string }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold text-foreground">File preview</h2><p className="mt-1 text-sm text-muted-foreground">Ready to validate and upload.</p></div><CheckCircle2 className="size-5 text-emerald-600" /></div>
      <div className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><FileSpreadsheet className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{fileName}</p><p className="mt-0.5 text-xs text-muted-foreground">CSV · 1.8 MB · 1,248 product rows</p></div>
        <Button variant="ghost" size="icon-sm" aria-label="Remove selected file"><X /></Button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded-lg bg-muted/50 p-3"><p className="font-semibold">12</p><p className="mt-1 text-xs text-muted-foreground">Columns</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="font-semibold">1,248</p><p className="mt-1 text-xs text-muted-foreground">Rows</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="font-semibold">98%</p><p className="mt-1 text-xs text-muted-foreground">Complete</p></div></div>
    </section>
  );
}
