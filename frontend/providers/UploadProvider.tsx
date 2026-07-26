'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { uploadService } from '@/services/upload.service';
import type { ImportRecord } from '@/types/upload';

interface UploadContextValue {
  imports: ImportRecord[];
  isLoading: boolean;
  refreshImports: () => Promise<void>;
}

const UploadContext = createContext<UploadContextValue | undefined>(undefined);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshImports = useCallback(async () => {
    setIsLoading(true);

    try {
      const importStatus = await uploadService.getImportStatus();
      setImports(Array.isArray(importStatus) ? importStatus : []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void uploadService.getImportStatus().then((data) => {
      if (isMounted) setImports(Array.isArray(data) ? data : []);
    }).finally(() => {
      if (isMounted) setIsLoading(false);
    });

    return () => { isMounted = false; };
  }, []);

  return (
    <UploadContext.Provider value={{ imports, isLoading, refreshImports }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useImports() {
  const context = useContext(UploadContext);

  if (!context) {
    throw new Error('useImports must be used within an UploadProvider');
  }

  return context;
}
