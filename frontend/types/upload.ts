export type ImportStatus = 'completed' | 'processing' | 'failed';

export interface ImportRecord {
  id: string;
  fileName: string;
  fileSize: number;
  source: string;
  status: ImportStatus;
  totalRows: number;
  importedRows: number;
  rejectedRows: number;
  createdAt: string;
  completedAt?: string;
}

export interface UploadValidationResult {
  isValid: boolean;
  errors: string[];
  rowsDetected?: number;
}
