'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { taxonomyService } from '@/services/taxonomy.service';
import type { TaxonomyNode } from '@/types/taxonomy';

interface TaxonomyContextValue {
  taxonomy: TaxonomyNode[];
  isLoading: boolean;
  refreshTaxonomy: () => Promise<void>;
}

const TaxonomyContext = createContext<TaxonomyContextValue | undefined>(undefined);

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  const [taxonomy, setTaxonomy] = useState<TaxonomyNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshTaxonomy = useCallback(async () => {
    setIsLoading(true);

    try {
      setTaxonomy(await taxonomyService.getTaxonomy());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void taxonomyService.getTaxonomy().then((data) => {
      if (isMounted) setTaxonomy(data);
    }).finally(() => {
      if (isMounted) setIsLoading(false);
    });

    return () => { isMounted = false; };
  }, []);

  return (
    <TaxonomyContext.Provider value={{ taxonomy, isLoading, refreshTaxonomy }}>
      {children}
    </TaxonomyContext.Provider>
  );
}

export function useTaxonomy() {
  const context = useContext(TaxonomyContext);

  if (!context) {
    throw new Error('useTaxonomy must be used within a TaxonomyProvider');
  }

  return context;
}
