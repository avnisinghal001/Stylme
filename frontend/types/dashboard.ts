export interface DashboardMetric {
  label: string;
  value: number;
  change: number;
  changeLabel: string;
}

export interface ProductStatusSummary {
  status: string;
  count: number;
  percentage: number;
}

export interface DashboardTrendPoint {
  date: string;
  products: number;
  approved: number;
  rejected: number;
}

export interface DashboardData {
  metrics: DashboardMetric[];
  statusSummary: ProductStatusSummary[];
  importTrend: DashboardTrendPoint[];
  recentProducts: string[];
}

export interface DashboardActivity {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorRole: string;
  createdAt: string | null;
}

export interface DashboardDistributionItem {
  name: string;
  count: number;
}

export interface DashboardStats {
  products: {
    total: number;
    active: number;
    pendingReview: number;
    rejected: number;
    missingImages: number;
  };
  sellers: {
    total: number;
    pending: number;
    approved: number;
  };
  brands: number;
  totalOffers: number;
  averageRating: number;
  categoryDistribution: DashboardDistributionItem[];
  statusDistribution: DashboardDistributionItem[];
  recentActivity: DashboardActivity[];
  generatedAt: string | null;
  isPartial: boolean;
}
