import { Check, Eye, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ProductRowActions({ productName }: { productName: string }) {
  return (
    <details className="relative">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${productName}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><Eye className="size-3.5" />View</button>
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><Pencil className="size-3.5" />Edit</button>
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><Check className="size-3.5 text-emerald-600" />Approve</button>
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><X className="size-3.5 text-amber-600" />Reject</button>
        <div className="my-1 border-t" />
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5" />Delete</button>
      </div>
    </details>
  );
}
