'use client';

import { type ChangeEvent, useRef } from 'react';
import { FolderOpen, ImageIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ImageFolderPreviewProps {
  files: File[];
  onFilesSelect: (files: File[]) => void;
  onRemove: () => void;
}

export function ImageFolderPreview({ files, onFilesSelect, onRemove }: ImageFolderPreviewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectFolder = () => {
    inputRef.current?.setAttribute('webkitdirectory', '');
    inputRef.current?.click();
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onFilesSelect(Array.from(event.target.files ?? []));

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold text-foreground">Image folder</h2><p className="mt-1 text-sm text-muted-foreground">Match image files to product IDs.</p></div><FolderOpen className="size-5 text-muted-foreground" /></div>
      <input ref={inputRef} onChange={handleChange} type="file" multiple accept="image/*" className="sr-only" aria-label="Select an image folder" />
      {files.length > 0 ? <div className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/20 p-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><ImageIcon className="size-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{files[0].webkitRelativePath.split('/')[0] || 'Selected image folder'}</p><p className="mt-0.5 text-xs text-muted-foreground">{files.length.toLocaleString('en-IN')} image files selected</p></div><Button variant="ghost" size="icon-sm" aria-label="Remove image folder" onClick={onRemove}><X /></Button></div> : <div className="mt-4 rounded-lg border border-dashed px-3 py-5 text-center"><p className="text-sm text-muted-foreground">No image folder selected.</p><Button variant="outline" size="sm" className="mt-3" onClick={selectFolder}><FolderOpen />Select Images Folder</Button></div>}
    </section>
  );
}
