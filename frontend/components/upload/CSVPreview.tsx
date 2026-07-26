import { CheckCircle2, FileSpreadsheet, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface CSVPreviewProps {
  file: File | null;
  onRemove: () => void;
}

const formatSize = (size: number) => `${(size / 1024 / 1024).toFixed(size >= 1024 * 1024 ? 1 : 2)} MB`;

export function CSVPreview({ file, onRemove }: CSVPreviewProps) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold text-foreground">CSV file</h2><p className="mt-1 text-sm text-muted-foreground">Selected dataset file.</p></div>{file && <CheckCircle2 className="size-5 text-emerald-600" />}</div>
      {file ? <div className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/20 p-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><FileSpreadsheet className="size-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{file.name}</p><p className="mt-0.5 text-xs text-muted-foreground">CSV · {formatSize(file.size)} · Ready for validation</p></div><Button variant="ghost" size="icon-sm" aria-label="Remove selected CSV" onClick={onRemove}><X /></Button></div> : <p className="mt-4 rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">No CSV selected yet.</p>}
    </section>
  );
}
