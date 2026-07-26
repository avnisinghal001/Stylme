'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { dashboardService } from '@/services/dashboard.service';
import type { DashboardData } from '@/types/dashboard';

interface DashboardContextValue {
  dashboard: DashboardData | undefined;
  isLoading: boolean;
  refreshDashboard: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [dashboard, setDashboard] = useState<DashboardData>();
  const [isLoading, setIsLoading] = useState(true);

  const refreshDashboard = useCallback(async () => {
    setIsLoading(true);

    try {
      setDashboard(await dashboardService.getDashboard());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void dashboardService.getDashboard().then((data) => {
      if (isMounted) setDashboard(data);
    }).finally(() => {
      if (isMounted) setIsLoading(false);
    });

    return () => { isMounted = false; };
  }, []);

  return (
    <DashboardContext.Provider value={{ dashboard, isLoading, refreshDashboard }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);

  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }

  return context;
}
