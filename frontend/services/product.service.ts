import { apiRequest } from '@/lib/api/client';
import type { Product } from '@/types/product';

type Raw = Record<string, unknown>;

export interface ProductSearchParams {
  query?: string;
  brand?: string;
  colour?: string;
  status?: Product['status'];
}

export interface ManagedProduct extends Product {
  sellerId: string;
  brandId: string;
  rejectionReason: string | null;
  sku: string;
}

export interface ProductDraftQuery {
  status?: 'draft' | 'pending_review' | 'approved' | 'rejected';
}

export type ProductReviewDecision = 'approved' | 'rejected';

const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const text = (...values: unknown[]) => values.find((value) => typeof value === 'string' && value.trim()) as string | undefined;
const number = (...values: unknown[]) => {
  for (const value of values) { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
  return 0;
};
const array = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

function status(value: unknown): Product['status'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'active' || normalized === 'approved') return 'approved';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'draft') return 'draft';
  return 'pending';
}

function normalize(value: unknown): Product | null {
  const raw = object(value);
  const name = text(raw.title, raw.name);
  if (!name) return null;
  const offer = object(raw.offer ?? (Array.isArray(raw.offers) ? raw.offers[0] : null));
  const price = object(raw.price);
  const brand = object(raw.brand);
  const rating = object(raw.rating);
  const media = Array.isArray(raw.media) ? raw.media.map(object) : [];
  const metadata = object(raw.metadata);
  const category = text(raw.categoryKey, raw.category_key, raw.category, 'uncategorized') ?? 'uncategorized';
  const productType = text(raw.productTypeKey, raw.product_type_key, raw.product_type, category) ?? category;
  const createdAt = text(raw.created_at, raw.createdAt, raw.updated_at, raw.updatedAt) ?? new Date(0).toISOString();
  return {
    id: text(raw.id, raw._id, raw.source_product_id, raw.slug, name) ?? name,
    name,
    price: Math.round(number(offer.salePricePaise, offer.sale_price_paise, price.salePricePaise, price.sale_price_paise, raw.sale_price_paise, raw.pricePaise, number(raw.price) * 100) / 100),
    colour: text(raw.colour, raw.color, array(offer.availableColorFamilyKeys ?? offer.available_color_family_keys)[0], 'Multi') ?? 'Multi',
    brand: text(brand.name, raw.brand_name, raw.brand, 'StylMe') ?? 'StylMe',
    img: text(raw.coverImageUrl, raw.cover_image_url, raw.img, media[0]?.displayUrl, media[0]?.display_url, media[0]?.url, '') ?? '',
    ratingCount: number(rating.count, raw.ratingCount, raw.rating_count),
    avgRating: number(rating.average, raw.avg_rating, raw.ratingAverage),
    description: text(raw.description, '') ?? '',
    attributes: {
      Department: array(raw.genderKeys ?? raw.gender_keys).join(', ') || 'Unisex',
      Category: category,
      'Sub Category': productType,
      ...Object.fromEntries(Object.entries(metadata).map(([key, item]) => [key, Array.isArray(item) ? item.map(String) : String(item)])),
    },
    status: status(raw.status),
    qualityScore: number(raw.qualityScore, raw.quality_score, 100),
    createdAt,
    updatedAt: text(raw.updated_at, raw.updatedAt, createdAt) ?? createdAt,
  };
}

function normalizeManagedProduct(
  value: unknown,
  brandNames: Map<string, string>,
  colourNames: Map<string, string>,
): ManagedProduct | null {
  const raw = object(value);
  const offer = object(raw.offer);
  const variants = Array.isArray(offer.variants) ? offer.variants.map(object) : [];
  const media = Array.isArray(raw.media) ? raw.media.map(object) : [];
  const metadata = object(raw.metadata);
  const id = text(raw.id, raw._id);
  const name = text(raw.title, raw.name);
  const sellerId = text(raw.sellerId, raw.seller_id);
  const brandId = text(raw.brandId, raw.brand_id);
  if (!id || !name || !sellerId || !brandId) return null;

  const category = text(raw.categoryKey, raw.category_key, raw.category, 'uncategorized') ?? 'uncategorized';
  const productType = text(raw.productTypeKey, raw.product_type_key, raw.product_type, category) ?? category;
  const createdAt = text(raw.createdAt, raw.created_at, raw.updatedAt, raw.updated_at) ?? new Date(0).toISOString();
  const firstVariant = variants[0] ?? {};
  const colorId = text(firstVariant.colorId, firstVariant.color_id);
  const colour = colorId ? colourNames.get(colorId) : undefined;

  return {
    id,
    sellerId,
    brandId,
    rejectionReason: text(raw.rejectionReason, raw.rejection_reason) ?? null,
    sku: text(firstVariant.sku, 'Not assigned') ?? 'Not assigned',
    name,
    price: Math.round(number(offer.salePricePaise, offer.sale_price_paise) / 100),
    colour: colour ?? text(raw.colour, raw.color, 'Multi') ?? 'Multi',
    brand: brandNames.get(brandId) ?? 'Managed brand',
    img: text(raw.coverImageUrl, raw.cover_image_url, media[0]?.displayUrl, media[0]?.display_url, media[0]?.url, '') ?? '',
    ratingCount: 0,
    avgRating: 0,
    description: text(raw.description, '') ?? '',
    attributes: {
      Department: array(raw.genderKeys ?? raw.gender_keys).join(', ') || 'Unisex',
      Category: category,
      'Sub Category': productType,
      ...Object.fromEntries(Object.entries(metadata).map(([key, item]) => [key, Array.isArray(item) ? item.map(String) : String(item)])),
    },
    status: status(raw.status),
    qualityScore: number(raw.qualityScore, raw.quality_score, 100),
    createdAt,
    updatedAt: text(raw.updatedAt, raw.updated_at, createdAt) ?? createdAt,
  };
}

const optionNameMap = (value: unknown) => new Map(
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const item = object(entry);
    const id = text(item.id, item._id);
    const name = text(item.name, item.displayName, item.display_name, item.label, item.slug);
    return id && name ? [[id, name] as const] : [];
  }),
);

export async function getManagedProducts(query: ProductDraftQuery = {}): Promise<ManagedProduct[]> {
  const draftSearch = new URLSearchParams({ page: '1', pageSize: '100' });
  if (query.status) draftSearch.set('status', query.status);
  const [draftPayload, options] = await Promise.all([
    query.status === 'approved'
      ? Promise.resolve({ items: [] as unknown[] })
      : apiRequest<{ items?: unknown[] }>(`/product-drafts?${draftSearch}`),
    apiRequest<Record<string, unknown>>('/product-drafts/options'),
  ]);
  const brandNames = optionNameMap(options.brands);
  const colourNames = optionNameMap(options.colors);
  const drafts = (draftPayload.items ?? [])
    .map((item) => normalizeManagedProduct(item, brandNames, colourNames))
    .filter((item): item is ManagedProduct => item !== null);

  if (query.status && query.status !== 'approved') return drafts;

  const first = await apiRequest<{ items?: unknown[]; total?: number; scope?: 'seller' | 'all' }>(
    '/managed-products?page=1&pageSize=100',
  );
  const publishedRows = [...(first.items ?? [])];
  const total = Math.max(0, Number(first.total) || 0);
  if (first.scope === 'seller' && total > publishedRows.length) {
    const pageCount = Math.ceil(total / 100);
    const remaining = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => (
      apiRequest<{ items?: unknown[] }>(`/managed-products?page=${index + 2}&pageSize=100`)
    )));
    remaining.forEach((payload) => publishedRows.push(...(payload.items ?? [])));
  }
  const published = publishedRows
    .map((value): ManagedProduct | null => {
      const item = normalize(value);
      if (!item) return null;
      const raw = object(value);
      const offer = object(Array.isArray(raw.offers) ? raw.offers[0] : null);
      const brand = object(raw.brand);
      return {
        ...item,
        sellerId: text(offer.sellerId, offer.seller_id) ?? '',
        brandId: text(brand.id, brand._id, offer.brandId, offer.brand_id) ?? '',
        rejectionReason: null,
        sku: text(offer.offerCode, offer.offer_code, 'Published') ?? 'Published',
      };
    })
    .filter((item): item is ManagedProduct => item !== null);
  return [...drafts.filter((item) => item.status !== 'approved'), ...published]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function reviewProductDraft(
  draftId: string,
  decision: ProductReviewDecision,
  reason?: string,
): Promise<unknown> {
  return apiRequest(`/admin/product-drafts/${encodeURIComponent(draftId)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({
      decision,
      reason: decision === 'rejected' ? reason?.trim() || null : null,
    }),
  });
}

async function page(params: ProductSearchParams = {}) {
  const query = new URLSearchParams({ page: '1', limit: '100' });
  if (params.query) query.set('search', params.query);
  if (params.brand) query.set('brand', params.brand);
  if (params.colour) query.set('colour', params.colour);
  if (params.status) query.set('status', params.status);
  const payload = await apiRequest<{ items: unknown[] }>(`/products?${query}`);
  return (payload.items ?? []).map(normalize).filter((item): item is Product => item !== null);
}

export const getProducts = () => page();

export async function getProduct(id: string): Promise<Product | undefined> {
  try { return normalize(await apiRequest(`/products/${encodeURIComponent(id)}`)) ?? undefined; }
  catch { return undefined; }
}

export const searchProducts = (params: ProductSearchParams = {}) => page(params);

export const productService = {
  getProducts,
  getProduct,
  searchProducts,
  getManagedProducts,
  reviewProductDraft,
};
