import type { DashboardData } from '@/types/dashboard';
import { mockProducts } from './products';

const statusCounts = mockProducts.reduce<Record<string, number>>((counts, product) => {
  counts[product.status] = (counts[product.status] ?? 0) + 1;
  return counts;
}, {});

export const mockDashboardData: DashboardData = {
  metrics: [
    { label: 'Total products', value: mockProducts.length, change: 12.5, changeLabel: 'vs. previous import' },
    { label: 'Approved products', value: statusCounts.approved ?? 0, change: 8.2, changeLabel: 'vs. previous import' },
    { label: 'Pending review', value: statusCounts.pending ?? 0, change: -4.1, changeLabel: 'vs. previous import' },
    { label: 'Average quality score', value: Math.round(mockProducts.reduce((sum, product) => sum + product.qualityScore, 0) / mockProducts.length), change: 2.4, changeLabel: 'vs. previous import' },
  ],
  statusSummary: Object.entries(statusCounts).map(([status, count]) => ({ status, count, percentage: Number(((count / mockProducts.length) * 100).toFixed(1)) })),
  importTrend: [
    { date: '2026-03-10', products: 14, approved: 11, rejected: 1 },
    { date: '2026-03-11', products: 18, approved: 14, rejected: 1 },
    { date: '2026-03-12', products: 12, approved: 9, rejected: 1 },
    { date: '2026-03-13', products: 21, approved: 17, rejected: 2 },
    { date: '2026-03-14', products: 16, approved: 13, rejected: 1 },
    { date: '2026-03-15', products: 19, approved: 15, rejected: 1 },
  ],
  recentProducts: mockProducts.slice(0, 5).map((product) => product.id),
};
