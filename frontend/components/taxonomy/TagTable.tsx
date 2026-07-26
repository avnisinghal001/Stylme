import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type TaxonomyTag = { id: string; name: string; description: string; productCount: number };

export function TagTable({ title, description, tags }: { title: string; description: string; tags: TaxonomyTag[] }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{tags.length} tags</span>
      </div>
      <Table>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-muted/50"><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Description</TableHead><TableHead>Products</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {tags.map((tag) => (
            <TableRow key={tag.id}>
              <TableCell className="font-medium">{tag.name}</TableCell>
              <TableCell className="hidden max-w-72 whitespace-normal text-muted-foreground sm:table-cell">{tag.description}</TableCell>
              <TableCell>{tag.productCount.toLocaleString('en-IN')}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${tag.name}`}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${tag.name}`}><MoreHorizontal className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${tag.name}`} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-4" /></Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
