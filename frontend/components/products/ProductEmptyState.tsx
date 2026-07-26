import { PackageSearch, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ProductEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <section className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground"><PackageSearch className="size-6" /></div>
      <h2 className="mt-4 text-lg font-semibold">No products found</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Try changing your search or filters to find products in the catalogue.</p>
      <Button variant="outline" className="mt-5" onClick={onReset}><RotateCcw />Reset filters</Button>
    </section>
  );
}
