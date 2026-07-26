import { ProductActions } from '@/components/products/ProductActions';
import { ProductStatusBadge } from '@/components/products/ProductStatusBadge';
import { ProductImage } from '@/components/shared/ProductImage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ProductReviewDecision } from '@/services/product.service';
import type { Product } from '@/types/product';

interface ProductTableProps {
  products: Product[];
  isLoading?: boolean;
  canReview?: boolean;
  onReview?: (product: Product, decision: ProductReviewDecision) => void;
}

const categoryFor = (product: Product) => String(product.attributes['Sub Category'] ?? product.attributes.Category ?? 'Uncategorized');
const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export function ProductTable({ products, isLoading = false, canReview = false, onReview }: ProductTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-muted/50">
            <TableHead>Image</TableHead><TableHead>Product name</TableHead><TableHead>Brand</TableHead><TableHead>Category</TableHead><TableHead>Colour</TableHead><TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead>Created date</TableHead><TableHead className="min-w-52 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? Array.from({ length: 10 }, (_, index) => (
            <TableRow key={index} className="hover:bg-transparent">
              {Array.from({ length: 9 }, (_, cell) => <TableCell key={cell}><div className="h-5 min-w-16 animate-pulse rounded bg-muted" /></TableCell>)}
            </TableRow>
          )) : products.map((product) => (
            <TableRow key={product.id}>
              <TableCell><div className="w-12"><ProductImage imageUrl={product.img} productName={product.name} width={48} height={60} /></div></TableCell>
              <TableCell className="min-w-60 whitespace-normal"><p className="font-medium text-foreground">{product.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{product.id}</p></TableCell>
              <TableCell className="font-medium">{product.brand}</TableCell>
              <TableCell>{categoryFor(product)}</TableCell>
              <TableCell>{product.colour}</TableCell>
              <TableCell className="font-medium">₹{product.price.toLocaleString('en-IN')}</TableCell>
              <TableCell><ProductStatusBadge status={product.status} /></TableCell>
              <TableCell>{formatDate(product.createdAt)}</TableCell>
              <TableCell className="text-right"><ProductActions product={product} canReview={canReview} onReview={onReview} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
