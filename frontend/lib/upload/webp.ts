'use client';

import { extractPalette } from '@/lib/upload/palette';
import { validateImageSignature, type SupportedImageMime } from '@/lib/upload/image-signature';
import type { PaletteColour } from '@/types/product-workflow';

const MAX_DIMENSION = 2400;
const AI_MAX_DIMENSION = 1024;
const QUALITY = 0.82;
const WORKER_TIMEOUT_MS = 30_000;

interface ConversionResult {
  normalizedBlob: Blob;
  aiBlob: Blob;
  width: number;
  height: number;
  aiWidth: number;
  aiHeight: number;
  palette: PaletteColour[];
}

export interface PreparedProductImage extends ConversionResult {
  detectedMime: SupportedImageMime;
  originalSha256: string;
  normalizedSha256: string;
  aiDataUrl: string;
}

const fit = (width: number, height: number, maximum: number) => {
  const longest = Math.max(width, height);
  if (longest <= maximum) return { width, height };
  const scale = maximum / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Browser could not encode WebP.')), 'image/webp', quality);
});

async function decodeWithImageElement(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Browser could not decode this image.'));
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image dimensions are invalid.');
    return {
      source: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function decodeImage(blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Safari/WebKit versions with partial createImageBitmap support can reject
      // orientation options. The HTMLImageElement path still decodes locally and
      // canvas redraw still strips EXIF before any AI request.
    }
  }
  return decodeWithImageElement(blob);
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('2D canvas is unavailable.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return { canvas, context };
}

async function convertOnMainThread(file: File): Promise<ConversionResult> {
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > 48_000_000) {
      throw new Error('Image dimensions are invalid or exceed 48 megapixels.');
    }
    const normalizedSize = fit(decoded.width, decoded.height, MAX_DIMENSION);
    const aiSize = fit(decoded.width, decoded.height, AI_MAX_DIMENSION);
    const normalized = draw(decoded.source, normalizedSize.width, normalizedSize.height);
    const ai = draw(decoded.source, aiSize.width, aiSize.height);
    const paletteCanvas = draw(ai.canvas, 48, 48);
    const palette = extractPalette(paletteCanvas.context.getImageData(0, 0, 48, 48).data);
    const [normalizedBlob, aiBlob] = await Promise.all([
      canvasToBlob(normalized.canvas, QUALITY),
      canvasToBlob(ai.canvas, 0.78),
    ]);
    return {
      normalizedBlob,
      aiBlob,
      width: normalizedSize.width,
      height: normalizedSize.height,
      aiWidth: aiSize.width,
      aiHeight: aiSize.height,
      palette,
    };
  } finally {
    decoded.dispose();
  }
}

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

async function convertInWorker(file: File): Promise<ConversionResult> {
  const worker = new Worker(new URL('../../workers/webp.worker.ts', import.meta.url), { type: 'module' });
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : [...crypto.getRandomValues(new Uint32Array(4))].map((value) => value.toString(16)).join('-');
  try {
    return await new Promise<ConversionResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Image worker timed out.')), WORKER_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<{ id: string; result?: ConversionResult; error?: string }>) => {
        if (event.data.id !== id) return;
        window.clearTimeout(timeout);
        if (event.data.error || !event.data.result) reject(new Error(event.data.error || 'Image worker failed.'));
        else resolve(event.data.result);
      };
      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        reject(new Error(event.message || 'Image worker failed.'));
      };
      worker.postMessage({
        id,
        blob: file,
        quality: QUALITY,
        maxDimension: MAX_DIMENSION,
        aiMaxDimension: AI_MAX_DIMENSION,
      });
    });
  } finally {
    worker.terminate();
  }
}

export async function sha256Hex(content: Blob | ArrayBuffer | string): Promise<string> {
  const bytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content instanceof Blob
      ? await content.arrayBuffer()
      : content;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image encoding failed.'));
    reader.onerror = () => reject(reader.error ?? new Error('Image encoding failed.'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareProductImage(file: File): Promise<PreparedProductImage> {
  const detectedMime = await validateImageSignature(file);
  const originalSha256Promise = sha256Hex(file);
  let converted: ConversionResult;
  const workerSupported = canUseWorker();
  try {
    converted = workerSupported ? await convertInWorker(file) : await convertOnMainThread(file);
  } catch (workerError) {
    if (!workerSupported) throw workerError;
    converted = await convertOnMainThread(file);
  }
  if (!converted.normalizedBlob.size || !converted.aiBlob.size) throw new Error('Image conversion produced an empty file.');
  if (converted.normalizedBlob.type !== 'image/webp' || converted.aiBlob.type !== 'image/webp') {
    throw new Error('This browser cannot encode WebP images. Update the browser and try again.');
  }

  const [originalSha256, normalizedSha256, aiDataUrl] = await Promise.all([
    originalSha256Promise,
    sha256Hex(converted.normalizedBlob),
    blobToDataUrl(converted.aiBlob),
  ]);
  return { ...converted, detectedMime, originalSha256, normalizedSha256, aiDataUrl };
}
