'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ProductPaginationProps {
  currentPage: number;
  pageCount: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export function ProductPagination({ currentPage, pageCount, pageSize, totalItems, onPageChange }: ProductPaginationProps) {
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>Showing {start}–{end} of {totalItems} products</p>
      <nav className="flex items-center gap-1 self-end sm:self-auto" aria-label="Product pagination">
        <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft />Previous</Button>
        <div className="hidden items-center gap-1 md:flex">
          {pages.map((page) => <Button key={page} variant={page === currentPage ? 'secondary' : 'ghost'} size="sm" aria-current={page === currentPage ? 'page' : undefined} onClick={() => onPageChange(page)}>{page}</Button>)}
        </div>
        <span className="text-xs md:hidden">Page {currentPage} of {pageCount}</span>
        <Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}>Next<ChevronRight /></Button>
      </nav>
    </div>
  );
}
