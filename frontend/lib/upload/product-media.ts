'use client';

import { uploadProductImageToImgBB } from '@/lib/upload/imgbb';
import { prepareProductImage } from '@/lib/upload/webp';
import type { ProcessedProductImage } from '@/types/product-workflow';

export async function processAndUploadProductImage(
  file: File,
  order: number,
): Promise<ProcessedProductImage> {
  const prepared = await prepareProductImage(file);
  const clientId = crypto.randomUUID();
  const asset = await uploadProductImageToImgBB(
    prepared.normalizedBlob,
    `stylme-${prepared.normalizedSha256.slice(0, 16)}.webp`,
  );

  return {
    clientId,
    order,
    isCover: order === 0,
    originalName: file.name,
    originalMime: prepared.detectedMime,
    originalBytes: file.size,
    originalSha256: prepared.originalSha256,
    normalizedSha256: prepared.normalizedSha256,
    width: prepared.width,
    height: prepared.height,
    normalizedBytes: prepared.normalizedBlob.size,
    palette: prepared.palette,
    aiDataUrl: prepared.aiDataUrl,
    aiWidth: prepared.aiWidth,
    aiHeight: prepared.aiHeight,
    aiBytes: prepared.aiBlob.size,
    asset: {
      ...asset,
      width: asset.width || prepared.width,
      height: asset.height || prepared.height,
      size: asset.size || prepared.normalizedBlob.size,
    },
  };
}

export function normalizeMediaOrder(images: ProcessedProductImage[]): ProcessedProductImage[] {
  return images.map((image, order) => ({ ...image, order, isCover: order === 0 }));
}
