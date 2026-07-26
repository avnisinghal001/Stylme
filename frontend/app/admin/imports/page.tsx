import PageHeader from '@/components/layout/PageHeader';
import { ImportErrors, type ImportError } from '@/components/imports/ImportErrors';
import { ImportLogs, type ImportLog } from '@/components/imports/ImportLogs';
import { ImportOverview } from '@/components/imports/ImportOverview';
import { ImportProgress } from '@/components/imports/ImportProgress';
import { ImportStatistics } from '@/components/imports/ImportStatistics';
import { mockImports } from '@/lib/mock-data/imports';

const currentImport = {
  id: 'IMP-1005',
  fileName: 'myntra-fashion-products-august.csv',
  status: 'In progress',
  total: 1248,
  imported: 842,
  successful: 816,
  rejected: 18,
  skipped: 8,
  remainingTime: '2 min 14 sec',
};

const liveLogs: ImportLog[] = [
  { id: 'log-1', message: 'Processed product batch 34 of 50.', time: 'Just now', status: 'processing' },
  { id: 'log-2', message: 'Image references validated for 25 products.', time: '1 minute ago', status: 'success' },
  { id: 'log-3', message: 'Skipped 2 records with incomplete category attributes.', time: '3 minutes ago', status: 'warning' },
  { id: 'log-4', message: 'Rejected product MYN-00831: duplicate product ID.', time: '4 minutes ago', status: 'error' },
  { id: 'log-5', message: 'Started import for myntra-fashion-products-august.csv.', time: '8 minutes ago', status: 'success' },
];

const importErrors: ImportError[] = [
  { id: 'MYN-00831', issue: 'Duplicate product ID', detail: 'This ID already exists in the catalogue.', severity: 'error' },
  { id: 'MYN-00902', issue: 'Missing image', detail: 'No matching image was found in the selected folder.', severity: 'warning' },
  { id: 'MYN-01016', issue: 'Broken image URL', detail: 'The supplied URL returned an unavailable image.', severity: 'error' },
];

export default function ImportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Import Progress" subtitle="Track the current catalogue import and review recent import activity." />
      <ImportOverview currentImport={currentImport} recentImports={mockImports} />
      <ImportProgress {...currentImport} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ImportLogs logs={liveLogs} />
        <ImportStatistics {...currentImport} />
      </div>
      <ImportErrors errors={importErrors} />
    </div>
  );
}
