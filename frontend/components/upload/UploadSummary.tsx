import { Image, PackageCheck, Rows3 } from 'lucide-react';

const summaryItems = [
  { label: 'Products detected', value: '1,248', icon: Rows3 },
  { label: 'Images matched', value: '1,162', icon: Image },
  { label: 'Ready to import', value: '1,206', icon: PackageCheck },
];

export function UploadSummary() {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Upload summary</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        {summaryItems.map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-3 rounded-lg bg-muted/40 p-3"><span className="flex size-9 items-center justify-center rounded-md bg-background text-muted-foreground"><Icon className="size-4" /></span><div><p className="text-lg font-semibold text-foreground">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></div>)}
      </div>
    </section>
  );
}
