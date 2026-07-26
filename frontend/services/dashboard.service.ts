import { mockDashboardData } from '@/lib/mock-data/dashboard';
import type { DashboardData } from '@/types/dashboard';

export const getDashboard = (): Promise<DashboardData> => Promise.resolve(mockDashboardData);

export const dashboardService = { getDashboard };
