import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';
import type { DashboardActivity, DashboardStats } from '@/types/dashboard';

const count = z.coerce.number().finite().nonnegative().catch(0);
const text = z.string().trim().catch('');
const nullableDate = z.string().datetime({ offset: true }).nullable().catch(null);

const productsSchema = z.object({
  total: count,
  active: count,
  pendingReview: count,
  rejected: count,
  missingImages: count,
}).catch({ total: 0, active: 0, pendingReview: 0, rejected: 0, missingImages: 0 });

const sellersSchema = z.object({
  total: count,
  pending: count,
  approved: count,
}).catch({ total: 0, pending: 0, approved: 0 });

const distributionSchema = z.array(z.object({ name: text, count })).catch([]);
const activitySchema = z.object({
  id: z.coerce.string().catch(''),
  action: text,
  entityType: text,
  entityId: z.coerce.string().catch(''),
  actorRole: text,
  createdAt: nullableDate,
});

const dashboardSchema = z.object({
  products: productsSchema,
  sellers: sellersSchema,
  brands: count,
  totalOffers: count,
  averageRating: count,
  categoryDistribution: distributionSchema,
  statusDistribution: distributionSchema,
  recentActivity: z.array(activitySchema).catch([]),
  generatedAt: nullableDate.optional().default(null),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPartialPayload(payload: unknown) {
  if (!isRecord(payload)) return true;
  return !isRecord(payload.products)
    || !isRecord(payload.sellers)
    || !Array.isArray(payload.categoryDistribution)
    || !Array.isArray(payload.statusDistribution)
    || !Array.isArray(payload.recentActivity);
}

export function normalizeDashboardStats(payload: unknown): DashboardStats {
  const parsed = dashboardSchema.parse(isRecord(payload) ? payload : {});
  const normalizeDistribution = (items: typeof parsed.categoryDistribution) => items
    .filter((item) => item.name && item.count > 0)
    .sort((left, right) => right.count - left.count);
  const recentActivity: DashboardActivity[] = parsed.recentActivity.map((item, index) => ({
    ...item,
    id: item.id || `${item.action || 'activity'}-${item.entityId || index}`,
  }));

  return {
    ...parsed,
    averageRating: Math.min(5, parsed.averageRating),
    categoryDistribution: normalizeDistribution(parsed.categoryDistribution),
    statusDistribution: normalizeDistribution(parsed.statusDistribution),
    recentActivity,
    isPartial: isPartialPayload(payload),
  };
}

export async function getDashboardStats(signal?: AbortSignal): Promise<DashboardStats> {
  const payload = await apiRequest<unknown>('/dashboard/stats', { signal });
  return normalizeDashboardStats(payload);
}
