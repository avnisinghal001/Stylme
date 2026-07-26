import { CheckCircle2, ImageOff, Link2Off, PackageSearch, Rows3 } from 'lucide-react';

const validationItems = [
  { label: 'Total products', value: '1,248', icon: Rows3, className: 'text-foreground' },
  { label: 'Missing images', value: '18', icon: ImageOff, className: 'text-amber-700' },
  { label: 'Duplicate IDs', value: '6', icon: PackageSearch, className: 'text-rose-700' },
  { label: 'Broken URLs', value: '7', icon: Link2Off, className: 'text-rose-700' },
  { label: 'Ready to import', value: '1,217', icon: CheckCircle2, className: 'text-emerald-700' },
];

export function ValidationSummary() {
  return <section className="rounded-xl border bg-card p-5"><div><h2 className="text-base font-semibold text-foreground">Validation results</h2><p className="mt-1 text-sm text-muted-foreground">Static preview of the checks that run before import.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{validationItems.map(({ label, value, icon: Icon, className }) => <div key={label} className="rounded-lg border bg-muted/20 p-3"><Icon className={`size-4 ${className}`} /><p className="mt-3 text-xl font-semibold text-foreground">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div></section>;
}
