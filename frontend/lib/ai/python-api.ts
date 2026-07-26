'use client';

import type {
  AiRunTelemetry,
  DraftOption,
  ProductAiResult,
  ProductDraftOptions,
  ProductDraftPayload,
  ProductDraftResponse,
} from '@/types/product-workflow';
import { normalizeProductTaxonomyPayload } from '@/lib/ai/metadata-taxonomy';
import { getPublicApiBaseUrl } from '@/lib/api/public-endpoints';

const apiBase = () => {
  return getPublicApiBaseUrl();
};

const accessToken = (injected?: string) => injected || window.localStorage.getItem('stylme.access_token') || '';

async function requestJson(path: string, init: RequestInit, injectedToken?: string) {
  const token = accessToken(injectedToken);
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = payload?.detail ?? payload?.message ?? payload?.error;
    const message = typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && typeof (detail as Record<string, unknown>).message === 'string'
        ? String((detail as Record<string, unknown>).message)
        : `StylMe API request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload ?? {};
}

const option = (value: unknown): DraftOption | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = item.id ?? item._id;
  const name = item.name ?? item.displayName ?? item.label ?? item.slug;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return {
    id,
    name,
    ...(typeof item.sellerId === 'string' ? { sellerId: item.sellerId } : {}),
    ...(Array.isArray(item.brandIds) ? { brandIds: item.brandIds.filter((brandId): brandId is string => typeof brandId === 'string') } : {}),
    ...(typeof item.hex === 'string' ? { hex: item.hex } : {}),
    ...(Array.isArray(item.familyKeys) ? { familyKeys: item.familyKeys.filter((key): key is string => typeof key === 'string') } : {}),
    ...(typeof item.pincode === 'string' ? { pincode: item.pincode } : {}),
  };
};

const optionList = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];
  return Array.isArray(value) ? value.map(option).filter((item): item is DraftOption => Boolean(item)) : [];
};

export async function getProductDraftOptions(token?: string, sellerId?: string): Promise<ProductDraftOptions> {
  const query = sellerId ? `?sellerId=${encodeURIComponent(sellerId)}` : '';
  const payload = await requestJson(`/product-drafts/options${query}`, { method: 'GET' }, token);
  const sizes = Array.isArray(payload.sizes) ? payload.sizes.filter((size): size is string => typeof size === 'string') : [];
  return {
    contractVersion: typeof payload.contractVersion === 'number' ? payload.contractVersion : 1,
    sellers: optionList(payload, 'sellers'),
    brands: optionList(payload, 'brands'),
    locations: optionList(payload, 'locations'),
    colors: optionList(payload, 'colors'),
    sizes: sizes.length ? sizes : ['one-size', 'xs', 's', 'm', 'l', 'xl', 'xxl'],
    ...(payload.metadata && typeof payload.metadata === 'object'
      ? { taxonomy: normalizeProductTaxonomyPayload(payload.metadata) }
      : {}),
  };
}

export interface AiReservation {
  runId: string;
  status: 'reserved' | 'processing' | 'completed' | 'failed';
  shouldProcess: boolean;
  result: unknown;
}

export async function reserveAiRun(input: {
  draftId: string;
  inputHash: string;
  contractVersion: number;
  metadataSchemaVersion: number;
  allowedFiltersHash: string;
}, token?: string): Promise<AiReservation> {
  const payload = await requestJson('/ai-processing/reserve', {
    method: 'POST',
    body: JSON.stringify({
      draftId: input.draftId,
      inputHash: input.inputHash,
      contractVersion: input.contractVersion,
      metadataSchemaVersion: input.metadataSchemaVersion,
      allowedFiltersHash: input.allowedFiltersHash,
      kind: 'product_details',
    }),
  }, token);
  const runId = payload.runId ?? payload.run_id ?? payload.id;
  const status = payload.status;
  if (typeof runId !== 'string' || !['reserved', 'processing', 'completed', 'failed'].includes(String(status))) {
    throw new Error('StylMe API returned an invalid AI reservation.');
  }
  const shouldProcess = payload.shouldProcess === true || payload.should_process === true;
  return { runId, status: status as AiReservation['status'], shouldProcess, result: payload };
}

const proposalMetadata = (result: ProductAiResult) => ({
  style: result.proposal.styles,
  theme: result.proposal.themes,
  occasion: result.proposal.occasions,
  festival: result.proposal.festivals,
  cultural_theme: result.proposal.culturalThemes,
  material: result.proposal.materials,
  pattern: result.proposal.patterns,
  fit: result.proposal.fits,
  silhouette: result.proposal.silhouettes,
  season: result.proposal.seasons,
  mood: result.proposal.moods,
  outfit_role: result.proposal.outfitRoles,
  generation: result.proposal.generations,
  trend_signal: result.proposal.trendSignals,
});

export async function completeAiRun(runId: string, result: ProductAiResult, token?: string) {
  return requestJson(`/ai-processing/${encodeURIComponent(runId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      provider: result.telemetry.provider,
      model: result.telemetry.model,
      proposal: {
        title: result.proposal.title,
        description: result.proposal.description,
        categoryKey: result.proposal.category,
        productTypeKey: result.proposal.productType,
        genderKeys: result.proposal.genders,
        metadata: proposalMetadata(result),
        colorProposals: result.proposal.colours.map((colour) => ({
          name: colour.name,
          hex: colour.hex,
          familyKeys: [colour.family],
          confidence: result.proposal.confidence,
        })),
      },
      confidence: result.proposal.confidence,
      warnings: result.proposal.warnings,
    }),
  }, token);
}

export async function failAiRun(runId: string, error: unknown, telemetry?: Partial<AiRunTelemetry>, token?: string) {
  await requestJson(`/ai-processing/${encodeURIComponent(runId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({
      provider: telemetry?.provider ?? null,
      model: telemetry?.model ?? null,
      errorCode: 'client_ai_generation_failed',
      errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'AI generation failed.',
    }),
  }, token);
}

export async function createProductDraft(payload: ProductDraftPayload, token?: string): Promise<ProductDraftResponse> {
  const response = await requestJson('/product-drafts', { method: 'POST', body: JSON.stringify(payload) }, token);
  const draftId = response.draftId ?? response.draft_id ?? response.id;
  if (typeof draftId !== 'string') throw new Error('StylMe API did not return a draft id.');
  return { draftId, status: typeof response.status === 'string' ? response.status : 'draft' };
}

export async function updateProductDraft(draftId: string, payload: ProductDraftPayload, token?: string): Promise<ProductDraftResponse> {
  const { sellerId: _sellerId, ...updates } = payload;
  void _sellerId;
  const response = await requestJson(`/product-drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  }, token);
  return {
    draftId: typeof response.id === 'string' ? response.id : draftId,
    status: typeof response.status === 'string' ? response.status : 'draft',
  };
}

export async function patchProductDraftFromAi(draftId: string, result: ProductAiResult, token?: string) {
  return requestJson(`/product-drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: result.proposal.title,
      description: result.proposal.description,
      categoryKey: result.proposal.category,
      productTypeKey: result.proposal.productType,
      genderKeys: result.proposal.genders,
      metadata: proposalMetadata(result),
    }),
  }, token);
}

export async function submitProductDraft(draftId: string, token?: string): Promise<ProductDraftResponse> {
  const response = await requestJson(`/product-drafts/${encodeURIComponent(draftId)}/submit`, { method: 'POST' }, token);
  return {
    draftId: typeof response.id === 'string' ? response.id : draftId,
    status: typeof response.status === 'string' ? response.status : 'pending_review',
  };
}
