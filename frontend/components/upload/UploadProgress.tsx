import { CheckCircle2, CircleDashed, FileSpreadsheet, ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface UploadProgressProps {
  csvFile: File | null;
  imageCount: number;
  isReady: boolean;
  onCancel: () => void;
  onProceed: () => void;
}

export function UploadProgress({ csvFile, imageCount, isReady, onCancel, onProceed }: UploadProgressProps) {
  const canProceed = Boolean(csvFile);

  return (
    <aside className="h-fit rounded-xl border bg-card p-5 xl:sticky xl:top-6">
      <h2 className="text-base font-semibold text-foreground">Import progress</h2>
      <p className="mt-1 text-sm text-muted-foreground">Review your selected files before proceeding.</p>
      <div className="mt-5 space-y-4">
        <div className="flex gap-3"><FileSpreadsheet className={`mt-0.5 size-4 ${csvFile ? 'text-emerald-600' : 'text-muted-foreground'}`} /><div><p className="text-sm font-medium">Product CSV</p><p className="text-xs text-muted-foreground">{csvFile ? csvFile.name : 'Waiting for a CSV file'}</p></div></div>
        <div className="flex gap-3"><ImageIcon className={`mt-0.5 size-4 ${imageCount ? 'text-emerald-600' : 'text-muted-foreground'}`} /><div><p className="text-sm font-medium">Product images</p><p className="text-xs text-muted-foreground">{imageCount ? `${imageCount.toLocaleString('en-IN')} images selected` : 'Optional image folder not selected'}</p></div></div>
        <div className="flex gap-3"><CircleDashed className={`mt-0.5 size-4 ${isReady ? 'hidden' : 'text-muted-foreground'}`} />{isReady && <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />}<div><p className="text-sm font-medium">Ready to import</p><p className="text-xs text-muted-foreground">{isReady ? 'Dataset marked ready in this local preview.' : 'Complete CSV selection to continue.'}</p></div></div>
      </div>
      <div className="mt-6 flex gap-2"><Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button><Button className="flex-1" disabled={!canProceed || isReady} onClick={onProceed}>{isReady ? 'Ready' : 'Proceed'}</Button></div>
    </aside>
  );
}
