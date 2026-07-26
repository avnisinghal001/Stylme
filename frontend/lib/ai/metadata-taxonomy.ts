'use client';

import { getPublicApiBaseUrl } from '@/lib/api/public-endpoints';
import {
  COLOUR_FAMILIES,
  PRODUCT_ARTICLE_TYPES,
  PRODUCT_CATEGORIES,
  PRODUCT_FITS,
  PRODUCT_GENDERS,
  PRODUCT_MATERIALS,
  PRODUCT_OCCASIONS,
  PRODUCT_PATTERNS,
  PRODUCT_SEASONS,
  PRODUCT_SILHOUETTES,
  PRODUCT_STYLES,
  PRODUCT_TAXONOMY_KEYS,
  PRODUCT_THEMES,
  type ProductTaxonomyContract,
  type ProductTaxonomyKey,
} from '@/types/product-workflow';

const CACHE_MS = 5 * 60_000;
let cached: { expiresAt: number; value: ProductTaxonomyContract } | undefined;

export type ProductTaxonomyFetchOptions = {
  forceRefresh?: boolean;
  allowFallback?: boolean;
};

const FALLBACK_OPTIONS: Record<ProductTaxonomyKey, readonly string[]> = {
  category: PRODUCT_CATEGORIES,
  product_type: PRODUCT_ARTICLE_TYPES,
  gender: PRODUCT_GENDERS,
  style: PRODUCT_STYLES,
  theme: PRODUCT_THEMES,
  occasion: PRODUCT_OCCASIONS,
  festival: ['diwali', 'eid', 'holi', 'navratri', 'wedding-season'],
  cultural_theme: ['indian', 'indo-western', 'modest', 'regional', 'western'],
  material: PRODUCT_MATERIALS,
  pattern: PRODUCT_PATTERNS,
  fit: PRODUCT_FITS,
  silhouette: PRODUCT_SILHOUETTES,
  season: PRODUCT_SEASONS,
  mood: ['bold', 'elegant', 'playful', 'relaxed', 'romantic', 'sophisticated'],
  outfit_role: ['base-layer', 'bottomwear', 'dress', 'footwear', 'layer', 'one-piece', 'outerwear', 'topwear'],
  color: COLOUR_FAMILIES,
  color_family: COLOUR_FAMILIES,
  size: ['3XS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'ONE_SIZE'],
  generation: ['gen-alpha', 'gen-z', 'millennial', 'gen-x', 'timeless'],
  trend_signal: ['trending', 'viral', 'emerging', 'evergreen'],
};

const DEFAULT_MAX: Partial<Record<ProductTaxonomyKey, number>> = {
  gender: 3,
  style: 5,
  theme: 6,
  occasion: 5,
  festival: 5,
  cultural_theme: 5,
  material: 5,
  pattern: 4,
  fit: 4,
  silhouette: 4,
  season: 4,
  mood: 5,
  outfit_role: 4,
  color: 8,
  color_family: 8,
  size: 20,
  generation: 3,
  trend_signal: 3,
};

function fallbackContract(): ProductTaxonomyContract {
  return {
    schemaVersion: 1,
    allowedFiltersHash: '0'.repeat(64),
    source: 'fallback',
    options: Object.fromEntries(PRODUCT_TAXONOMY_KEYS.map((key) => [key, [...FALLBACK_OPTIONS[key]]])) as Record<ProductTaxonomyKey, string[]>,
    maxSelections: { ...DEFAULT_MAX },
  };
}

function optionValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const option = value as Record<string, unknown>;
  if (option.active === false || option.status === 'inactive') return null;
  for (const candidate of [option.key, option.value, option.slug, option.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function normalizeProductTaxonomyPayload(payload: unknown): ProductTaxonomyContract {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const rawFields = Array.isArray(payload) ? payload : Array.isArray(root.fields) ? root.fields : [];
  const fallback = fallbackContract();
  const options = PRODUCT_TAXONOMY_KEYS.reduce((result, key) => {
    result[key] = [];
    return result;
  }, {} as Record<ProductTaxonomyKey, string[]>);
  const maxSelections = { ...fallback.maxSelections };

  for (const value of rawFields) {
    if (!value || typeof value !== 'object') continue;
    const field = value as Record<string, unknown>;
    const key = field.key;
    if (typeof key !== 'string' || !PRODUCT_TAXONOMY_KEYS.includes(key as ProductTaxonomyKey)) continue;
    if (field.aiAllowed === false || field.geminiAllowed === false || field.gemini_allowed === false) continue;
    const normalizedKey = key as ProductTaxonomyKey;
    const rawOptions = Array.isArray(field.options) ? field.options : [];
    const normalized = [...new Set(rawOptions.map(optionValue).filter((option): option is string => Boolean(option)))];
    if (normalized.length) options[normalizedKey] = normalized;
    const validation = field.validation && typeof field.validation === 'object' ? field.validation as Record<string, unknown> : {};
    const maximum = validation.maxSelections ?? validation.max_selections;
    if (typeof maximum === 'number' && Number.isFinite(maximum) && maximum > 0) {
      maxSelections[normalizedKey] = Math.floor(maximum);
    }
  }

  return {
    schemaVersion: typeof root.schemaVersion === 'number' ? root.schemaVersion : typeof root.schema_version === 'number' ? root.schema_version : 1,
    allowedFiltersHash: typeof root.allowedFiltersHash === 'string' ? root.allowedFiltersHash : typeof root.allowed_filters_hash === 'string' ? root.allowed_filters_hash : 'mongo-unversioned',
    source: 'mongo',
    options,
    maxSelections,
  };
}

export function primeProductTaxonomy(value: ProductTaxonomyContract) {
  cached = { value, expiresAt: Date.now() + CACHE_MS };
}

export function invalidateProductTaxonomy() {
  cached = undefined;
}

export async function getProductTaxonomy(
  accessToken?: string,
  options: ProductTaxonomyFetchOptions = {},
): Promise<ProductTaxonomyContract> {
  const { forceRefresh = false, allowFallback = true } = options;
  if (!forceRefresh && cached && cached.expiresAt > Date.now() && cached.value.source === 'mongo') return cached.value;
  const base = getPublicApiBaseUrl();
  const token = accessToken || window.localStorage.getItem('stylme.access_token') || '';

  try {
    const refreshQuery = forceRefresh ? `?contractRefresh=${Date.now()}` : '';
    const response = await fetch(`${base}/metadata/fields${refreshQuery}`, {
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Metadata fields failed (${response.status}).`);
    const value = normalizeProductTaxonomyPayload(await response.json());
    if (!/^[a-f0-9]{64}$/.test(value.allowedFiltersHash)) throw new Error('Metadata fields returned an invalid allowlist hash.');
    primeProductTaxonomy(value);
    return value;
  } catch (error) {
    if (!allowFallback) {
      throw error instanceof Error ? error : new Error('The live metadata contract could not be loaded.');
    }
    // A transient API/CORS failure must never poison the module cache with a
    // version-1 fallback. Read-only screens may render the fallback, while every
    // AI write path explicitly requires a fresh Mongo-backed contract.
    return fallbackContract();
  }
}
