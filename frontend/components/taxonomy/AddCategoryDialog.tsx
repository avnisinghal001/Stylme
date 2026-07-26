'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function AddCategoryDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus />Add category</Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="add-category-title">
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div><h3 id="add-category-title" className="text-lg font-semibold">Add category</h3><p className="mt-1 text-sm text-muted-foreground">Create a new top-level category or subcategory.</p></div>
              <Button variant="ghost" size="icon-sm" aria-label="Close dialog" onClick={() => setOpen(false)}><X /></Button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="grid gap-1.5 text-sm font-medium">Category name<input className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" placeholder="e.g. Accessories" /></label>
              <label className="grid gap-1.5 text-sm font-medium">Parent category<select className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"><option>None (top-level category)</option><option>Women</option><option>Men</option><option>Kids</option></select></label>
            </div>
            <div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => setOpen(false)}>Add category</Button></div>
          </div>
        </div>
      )}
    </>
  );
}
