import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ page, totalPages, pathname, params }: { page: number; totalPages: number; pathname: string; params: Record<string, string | string[] | undefined> }) {
  if (totalPages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((item) => { if (item) query.append(key, item); });
      else if (value) query.set(key, value);
    });
    query.set("page", String(target));
    return `${pathname}?${query.toString()}`;
  };
  return (
    <nav aria-label="Catalog pagination" className="mt-10 flex items-center justify-center gap-2">
      <PageLink href={href(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft className="size-4" /> Previous</PageLink>
      <span className="rounded-full bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-800">{page} / {totalPages}</span>
      <PageLink href={href(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Next <ChevronRight className="size-4" /></PageLink>
    </nav>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span aria-disabled="true" className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-300">{children}</span>;
  return <Link href={href} className="inline-flex items-center gap-1 rounded-full border border-pink-200 px-4 py-2 text-sm font-semibold text-pink-700 transition hover:bg-pink-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500">{children}</Link>;
}
