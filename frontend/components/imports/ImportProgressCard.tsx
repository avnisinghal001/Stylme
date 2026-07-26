import { CheckCircle2, Clock3, PackageCheck, TriangleAlert } from 'lucide-react';

type ImportProgressCardProps = {
  processed: number;
  total: number;
  successful: number;
  failed: number;
  remainingTime: string;
};

const numberFormatter = new Intl.NumberFormat('en-IN');

export function ImportProgressCard({
  processed,
  total,
  successful,
  failed,
  remainingTime,
}: ImportProgressCardProps) {
  const progress = Math.round((processed / total) * 100);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">Current import</p>
          <h3 className="mt-1 text-lg font-semibold text-gray-900">Myntra catalogue — July 2026</h3>
          <p className="mt-1 text-sm text-gray-500">Processing product data and image references.</p>
        </div>
        <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">In progress</span>
      </div>

      <div className="mt-7">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-gray-900">{progress}%</p>
            <p className="text-sm text-gray-500">{numberFormatter.format(processed)} of {numberFormatter.format(total)} products processed</p>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <Clock3 className="size-4 text-gray-400" />
            {remainingTime} remaining
          </div>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Import progress">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <ProgressMetric icon={<PackageCheck className="size-5 text-blue-600" />} label="Processed products" value={numberFormatter.format(processed)} tone="bg-blue-50" />
        <ProgressMetric icon={<CheckCircle2 className="size-5 text-emerald-600" />} label="Successful products" value={numberFormatter.format(successful)} tone="bg-emerald-50" />
        <ProgressMetric icon={<TriangleAlert className="size-5 text-rose-600" />} label="Failed products" value={numberFormatter.format(failed)} tone="bg-rose-50" />
      </div>
    </section>
  );
}

function ProgressMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 p-4">
      <span className={`grid size-10 place-items-center rounded-lg ${tone}`}>{icon}</span>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="mt-0.5 text-lg font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
}
