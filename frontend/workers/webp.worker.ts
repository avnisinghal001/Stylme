/// <reference lib="webworker" />

import { extractPalette } from '../lib/upload/palette';

type WorkerRequest = {
  id: string;
  blob: Blob;
  quality: number;
  maxDimension: number;
  aiMaxDimension: number;
};

const fit = (width: number, height: number, maximum: number) => {
  const longest = Math.max(width, height);
  if (longest <= maximum) return { width, height };
  const scale = maximum / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const draw = (bitmap: ImageBitmap, width: number, height: number) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('2D canvas is unavailable.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return { canvas, context };
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, blob, quality, maxDimension, aiMaxDimension } = event.data;
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 48_000_000) {
      bitmap.close();
      throw new Error('Image dimensions are invalid or exceed 48 megapixels.');
    }

    const normalizedSize = fit(bitmap.width, bitmap.height, maxDimension);
    const aiSize = fit(bitmap.width, bitmap.height, aiMaxDimension);
    const normalized = draw(bitmap, normalizedSize.width, normalizedSize.height);
    const ai = draw(bitmap, aiSize.width, aiSize.height);
    bitmap.close();

    const paletteCanvas = new OffscreenCanvas(48, 48);
    const paletteContext = paletteCanvas.getContext('2d', { willReadFrequently: true });
    if (!paletteContext) throw new Error('Palette canvas is unavailable.');
    paletteContext.drawImage(ai.canvas, 0, 0, 48, 48);
    const palette = extractPalette(paletteContext.getImageData(0, 0, 48, 48).data);

    const [normalizedBlob, aiBlob] = await Promise.all([
      normalized.canvas.convertToBlob({ type: 'image/webp', quality }),
      ai.canvas.convertToBlob({ type: 'image/webp', quality: Math.min(quality, 0.78) }),
    ]);
    if (normalizedBlob.type !== 'image/webp' || aiBlob.type !== 'image/webp') {
      throw new Error('This browser cannot encode WebP images.');
    }

    self.postMessage({
      id,
      result: {
        normalizedBlob,
        aiBlob,
        width: normalizedSize.width,
        height: normalizedSize.height,
        aiWidth: aiSize.width,
        aiHeight: aiSize.height,
        palette,
      },
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
