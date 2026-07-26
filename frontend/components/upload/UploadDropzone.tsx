'use client';

import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UploadDropzoneProps {
  csvFile: File | null;
  onCsvSelect: (file: File) => void;
}

export function UploadDropzone({ csvFile, onCsvSelect }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const selectFile = (file?: File) => {
    if (file) onCsvSelect(file);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0]);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <div onDragEnter={() => setIsDragging(true)} onDragLeave={() => setIsDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className={cn('flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition-colors', isDragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20')}>
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><UploadCloud className="size-6" /></div>
        <h2 className="mt-4 text-base font-semibold text-foreground">Drop your product CSV here</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Drag and drop a CSV file, or select one from your computer. Maximum file size: 25 MB.</p>
        {csvFile && <p className="mt-3 text-sm font-medium text-emerald-700">Selected: {csvFile.name}</p>}
        <input ref={inputRef} onChange={handleChange} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Select a CSV file" />
        <Button className="mt-5" onClick={() => inputRef.current?.click()}><FileSpreadsheet />Select CSV</Button>
      </div>
    </section>
  );
}
