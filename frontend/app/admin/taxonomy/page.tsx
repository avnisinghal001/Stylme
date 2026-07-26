'use client';

import { Database, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api/client';

interface MetadataOption { key: string; label: string; active?: boolean }
interface MetadataField { key: string; label: string; group: string; storagePath?: string; control?: string; filterable?: boolean; searchable?: boolean; options: MetadataOption[] }

function normalize(payload: unknown): MetadataField[] {
  const source = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray((payload as { fields?: unknown }).fields) ? (payload as { fields: unknown[] }).fields : [];
  return source.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const key = String(raw.key ?? '');
    if (!key) return [];
    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    return [{
      key,
      label: String(raw.label ?? key),
      group: String(raw.group ?? 'other'),
      storagePath: String(raw.storagePath ?? raw.storage_path ?? ''),
      control: String(raw.control ?? ''),
      filterable: Boolean(raw.filterable),
      searchable: Boolean(raw.searchable),
      options: rawOptions.map((option) => typeof option === 'string' ? { key: option, label: option } : ({ key: String((option as Record<string, unknown>).key ?? ''), label: String((option as Record<string, unknown>).label ?? (option as Record<string, unknown>).key ?? ''), active: (option as Record<string, unknown>).active !== false })).filter((option) => option.key),
    }];
  });
}

export default function TaxonomyPage() {
  const [fields, setFields] = useState<MetadataField[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setFields(normalize(await apiRequest('/metadata/fields'))); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load controlled metadata.'); }
    finally { setIsLoading(false); }
  }, []);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  const visible = useMemo(() => { const query = search.trim().toLowerCase(); return !query ? fields : fields.filter((field) => [field.key, field.label, field.group, ...field.options.flatMap((option) => [option.key, option.label])].some((value) => value.toLowerCase().includes(query))); }, [fields, search]);
  return <div className="space-y-6"><PageHeader title="Controlled taxonomy" subtitle="The same reusable Mongo metadata options power admin forms, AI output validation, storefront filters and search." actions={<Button variant="outline" onClick={() => void load()} disabled={isLoading}><RefreshCw className={isLoading ? 'animate-spin' : ''} />Refresh</Button>} />{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}<div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fields or options" className="h-11 w-full rounded-xl border bg-white pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-pink-100" /></div>{isLoading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-primary" /></div> : <div className="grid gap-4 lg:grid-cols-2">{visible.map((field) => <section key={field.key} className="rounded-2xl border border-pink-100 bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{field.group}</p><h2 className="mt-1 font-heading text-lg font-semibold">{field.label}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{field.storagePath || field.key}</p></div><span className="rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium text-primary">{field.options.length} options</span></div><div className="mt-4 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{field.options.slice(0, 250).map((option) => <span key={option.key} className="rounded-full border bg-background px-2.5 py-1 text-xs" title={option.key}>{option.label}</span>)}{field.options.length === 0 && <span className="text-sm text-muted-foreground">No fixed options</span>}</div><div className="mt-4 flex gap-2 text-[11px] text-muted-foreground"><span>{field.control || 'text'}</span>{field.filterable && <span>· filterable</span>}{field.searchable && <span>· searchable</span>}</div></section>)}{visible.length === 0 && <div className="col-span-full grid min-h-56 place-items-center rounded-2xl border border-dashed text-center"><div><Database className="mx-auto size-8 text-pink-300" /><p className="mt-3 font-medium">No metadata fields match</p></div></div>}</div>}</div>;
}
