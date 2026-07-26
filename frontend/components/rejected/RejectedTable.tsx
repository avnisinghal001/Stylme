import { LoaderCircle, PackageSearch, Pencil, RefreshCw } from 'lucide-react';
import Link from 'next/link';

import { RejectionReasonBadge, type RejectionReason } from '@/components/rejected/RejectionReasonBadge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type RejectedProduct = {
  id: string;
  product: string;
  sku: string;
  brand: string;
  reason: RejectionReason;
  rejectedAt: string;
};

export function RejectedTable({ products, busyId, onRevalidate }: { products: RejectedProduct[]; busyId?: string; onRevalidate?: (id: string) => void }) {
  if (products.length === 0) {
    return <section className="grid min-h-64 place-items-center rounded-xl border border-dashed bg-card p-8 text-center"><div><PackageSearch className="mx-auto size-8 text-pink-300" /><h2 className="mt-3 font-semibold">No rejected products</h2><p className="mt-1 text-sm text-muted-foreground">Products rejected for this seller account will appear here.</p></div></section>;
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-muted/50">
            <TableHead>Product</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead>Rejection Reason</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell className="min-w-64 whitespace-normal">
                <p className="font-medium text-foreground">{product.product}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">SKU: {product.sku}</p>
              </TableCell>
              <TableCell className="font-medium">{product.brand}</TableCell>
              <TableCell><RejectionReasonBadge reason={product.reason} /></TableCell>
              <TableCell className="text-muted-foreground">{product.rejectedAt}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Link href={`/admin/products/${encodeURIComponent(product.id)}?mode=edit`} aria-label={`Edit ${product.product}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Pencil className="size-4" /> <span className="hidden sm:inline">Edit</span></Link>
                  {onRevalidate && <Button variant="ghost" size="sm" aria-label={`Revalidate ${product.product}`} disabled={busyId === product.id} onClick={() => onRevalidate(product.id)}>{busyId === product.id ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} <span className="hidden sm:inline">Resubmit</span></Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="border-t px-4 py-3 text-sm text-muted-foreground">Showing {products.length} rejected products</div>
    </div>
  );
}
