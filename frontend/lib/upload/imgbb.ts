'use client';

import type { ImgBBAsset } from '@/types/product-workflow';

interface ImgBBResponse {
  success?: boolean;
  data?: {
    id?: string;
    url?: string;
    display_url?: string;
    delete_url?: string;
    width?: number;
    height?: number;
    size?: number;
    image?: { mime?: string };
  };
  error?: { message?: string };
}

export async function uploadProductImageToImgBB(blob: Blob, filename: string): Promise<ImgBBAsset> {
  const key = process.env.NEXT_PUBLIC_IMGBB_KEY?.trim();
  if (!key) throw new Error('NEXT_PUBLIC_IMGBB_KEY is not configured.');
  if (blob.type !== 'image/webp') throw new Error('Only normalized WebP images may be uploaded.');

  const form = new FormData();
  form.append('image', blob, filename.replace(/\.[^.]+$/, '') + '.webp');
  form.append('name', filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80));

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null) as ImgBBResponse | null;
  const url = payload?.data?.url;
  if (!response.ok || !payload?.success || !url) {
    throw new Error(payload?.error?.message || `ImgBB upload failed (${response.status}).`);
  }

  return {
    provider: 'imgbb',
    id: payload.data?.id ?? null,
    url,
    displayUrl: payload.data?.display_url ?? url,
    deleteUrl: payload.data?.delete_url ?? null,
    width: payload.data?.width ?? 0,
    height: payload.data?.height ?? 0,
    size: payload.data?.size ?? blob.size,
    mime: 'image/webp',
  };
}
