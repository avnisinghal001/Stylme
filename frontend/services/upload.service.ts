import { mockImports } from '@/lib/mock-data/imports';
import type { ImportRecord } from '@/types/upload';

export const getImportStatus = (id?: string): Promise<ImportRecord | ImportRecord[] | undefined> => {
  if (id) {
    return Promise.resolve(mockImports.find((record) => record.id === id));
  }

  return Promise.resolve(mockImports);
};

export const uploadService = { getImportStatus };
