import type { ImportRecord } from '@/types/upload';

export const mockImports: ImportRecord[] = [
  { id: 'IMP-1004', fileName: 'myntra-fashion-products-july.csv', fileSize: 1843200, source: 'Myntra Fashion Product Dataset', status: 'completed', totalRows: 100, importedRows: 94, rejectedRows: 6, createdAt: '2026-03-15T10:30:00.000Z', completedAt: '2026-03-15T10:31:14.000Z' },
  { id: 'IMP-1003', fileName: 'myntra-fashion-products-june.csv', fileSize: 1628400, source: 'Myntra Fashion Product Dataset', status: 'completed', totalRows: 250, importedRows: 241, rejectedRows: 9, createdAt: '2026-03-08T09:15:00.000Z', completedAt: '2026-03-08T09:17:36.000Z' },
  { id: 'IMP-1002', fileName: 'catalogue-review.csv', fileSize: 786400, source: 'Manual upload', status: 'failed', totalRows: 75, importedRows: 0, rejectedRows: 75, createdAt: '2026-03-01T14:42:00.000Z' },
];
