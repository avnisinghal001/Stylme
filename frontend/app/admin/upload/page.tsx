'use client';

import { useState } from 'react';

import { NewProductWorkflow } from '@/components/admin/products/NewProductWorkflow';
import PageHeader from '@/components/layout/PageHeader';
import { CSVPreview } from '@/components/upload/CSVPreview';
import { UploadDropzone } from '@/components/upload/UploadDropzone';

export default function UploadPage() {
  const [csvFile, setCsvFile] = useState<File | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Create Product" subtitle="Process product media in the browser, generate one controlled AI proposal, review it, and submit the URLs and JSON to StylMe." />
      <NewProductWorkflow />

      <details className="rounded-xl border bg-card p-5">
        <summary className="cursor-pointer text-sm font-semibold">Secondary workflow: import an existing CSV</summary>
        <p className="mt-2 text-sm text-muted-foreground">CSV image URLs remain unchanged and use the separate catalogue ingestion pipeline.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <UploadDropzone csvFile={csvFile} onCsvSelect={setCsvFile} />
          <CSVPreview file={csvFile} onRemove={() => setCsvFile(null)} />
        </div>
      </details>
    </div>
  );
}
