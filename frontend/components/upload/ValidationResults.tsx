import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

const validationItems = [
  { label: 'Valid rows', value: '1,206', icon: CheckCircle2, className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { label: 'Warnings', value: '31', icon: AlertTriangle, className: 'text-amber-700 bg-amber-50 border-amber-200' },
  { label: 'Rows needing review', value: '11', icon: Info, className: 'text-rose-700 bg-rose-50 border-rose-200' },
];

export function ValidationResults() {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div><h2 className="text-base font-semibold text-foreground">Validation results</h2><p className="mt-1 text-sm text-muted-foreground">Sample validation results from this dataset.</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {validationItems.map(({ label, value, icon: Icon, className }) => <div key={label} className={`rounded-lg border p-3 ${className}`}><Icon className="size-4" /><p className="mt-3 text-xl font-semibold">{value}</p><p className="text-xs">{label}</p></div>)}
      </div>
      <div className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Most common issue:</span> 18 rows are missing a product image reference.</div>
    </section>
  );
}
