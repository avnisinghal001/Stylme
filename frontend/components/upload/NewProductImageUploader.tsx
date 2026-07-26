'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ImagePlus, LoaderCircle, Palette, Trash2 } from 'lucide-react';

import { ProductImage } from '@/components/shared/ProductImage';
import { Button } from '@/components/ui/button';
import { normalizeMediaOrder, processAndUploadProductImage } from '@/lib/upload/product-media';
import type { ProcessedProductImage } from '@/types/product-workflow';

const MAX_IMAGES = 6;

interface NewProductImageUploaderProps {
  value?: ProcessedProductImage[];
  onChange?: (images: ProcessedProductImage[]) => void;
  disabled?: boolean;
}

const formatBytes = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function NewProductImageUploader({ value, onChange, disabled = false }: NewProductImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [internal, setInternal] = useState<ProcessedProductImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const images = value ?? internal;

  const commit = (next: ProcessedProductImage[]) => {
    const normalized = normalizeMediaOrder(next);
    if (value === undefined) setInternal(normalized);
    onChange?.(normalized);
  };

  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length || isProcessing) return;
    if (images.length >= MAX_IMAGES) {
      setErrors([`A product can have at most ${MAX_IMAGES} images.`]);
      return;
    }

    const queue = selected.slice(0, MAX_IMAGES - images.length);
    const working = [...images];
    const failures: string[] = selected.length > queue.length
      ? [`Only the first ${queue.length} selected images fit the ${MAX_IMAGES}-image limit.`]
      : [];
    setErrors([]);
    setIsProcessing(true);
    try {
      for (const [index, file] of queue.entries()) {
        setProgress(`Processing and uploading ${index + 1} of ${queue.length}: ${file.name}`);
        try {
          const ready = await processAndUploadProductImage(file, working.length);
          if (working.some((image) => image.originalSha256 === ready.originalSha256)) {
            failures.push(`${file.name} is a duplicate and was skipped.`);
            continue;
          }
          working.push(ready);
          commit(working);
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : 'processing failed'}`);
        }
      }
    } finally {
      setErrors(failures);
      setProgress('');
      setIsProcessing(false);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= images.length) return;
    const next = [...images];
    [next[index], next[destination]] = [next[destination], next[index]];
    commit(next);
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground"><ImagePlus className="size-4" />Product media</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            JPEG, PNG, or WebP up to 20 MB. Your browser validates, rotates, strips EXIF, resizes, converts to WebP, extracts colours, and uploads directly to ImgBB.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled || isProcessing || images.length >= MAX_IMAGES}>
          {isProcessing ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
          {isProcessing ? 'Working…' : 'Add images'}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={selectFiles}
        aria-label="Select product images"
      />

      {progress && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{progress}</p>}
      {errors.length > 0 && <div role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors.map((error) => <p key={error}>{error}</p>)}</div>}

      {images.length === 0 && !isProcessing && (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="mt-4 flex min-h-36 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 p-6 text-center transition hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60">
          <ImagePlus className="size-7 text-primary" />
          <span className="mt-2 text-sm font-medium">Choose the cover and variant images</span>
          <span className="mt-1 text-xs text-muted-foreground">The first image becomes the cover. Add up to {MAX_IMAGES}.</span>
        </button>
      )}

      {images.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" />{images.length} processed and hosted</p>
          <ol className="grid gap-3 md:grid-cols-2">
            {images.map((image, index) => (
              <li key={image.clientId} className="flex gap-3 rounded-xl border bg-muted/10 p-3">
                <div className="w-20 shrink-0"><ProductImage imageUrl={image.asset.displayUrl} productName={image.originalName} width={4} height={5} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{index === 0 ? 'Cover · ' : `${index + 1} · `}{image.originalName}</p><p className="mt-0.5 text-xs text-muted-foreground">{image.width}×{image.height} · {formatBytes(image.normalizedBytes)} WebP</p></div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${image.originalName}`} onClick={() => commit(images.filter((item) => item.clientId !== image.clientId))} disabled={disabled || isProcessing}><Trash2 /></Button>
                  </div>
                  <div className="mt-3 flex items-center gap-1">
                    <Palette className="mr-1 size-3.5 text-muted-foreground" />
                    {image.palette.slice(0, 5).map((colour) => <span key={colour.hex} title={`${colour.hex} · ${colour.family}`} className="size-4 rounded-full border shadow-sm" style={{ backgroundColor: colour.hex }} />)}
                    <span className="ml-auto flex gap-1"><Button variant="ghost" size="icon-xs" aria-label="Move image up" onClick={() => move(index, -1)} disabled={disabled || isProcessing || index === 0}><ArrowUp /></Button><Button variant="ghost" size="icon-xs" aria-label="Move image down" onClick={() => move(index, 1)} disabled={disabled || isProcessing || index === images.length - 1}><ArrowDown /></Button></span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
