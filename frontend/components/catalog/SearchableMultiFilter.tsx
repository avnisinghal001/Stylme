"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

export type MultiFilterOption = { value: string; label: string; submitValue?: string; hex?: string };

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

// Some production facets contain thousands of values (brands currently exceed
// 4,000). Rendering every checkbox twice for the responsive desktop/mobile
// layouts can lock up the browser before the shopper has opened the facet.
const MAX_RENDERED_OPTIONS = 60;

function selectedOptionValues(options: MultiFilterOption[], selected: string[]) {
  const valueByAlias = new Map<string, string>();
  options.forEach((option) => {
    valueByAlias.set(normalized(option.value), option.value);
    valueByAlias.set(normalized(option.label), option.value);
  });
  return [...new Set(selected.map((value) => valueByAlias.get(normalized(value)) ?? value))];
}

export function SearchableMultiFilter({ label, name, options, selected = [], initiallyOpen = false }: {
  label: string;
  name: string;
  options: MultiFilterOption[];
  selected?: string[];
  initiallyOpen?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(selected.length > 0 || initiallyOpen);
  const deferredSearch = useDeferredValue(search);
  const [checked, setChecked] = useState(() => new Set(selectedOptionValues(options, selected)));
  const optionsByValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const visible = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    const matching = options.filter((option) => !query || `${option.label} ${option.value}`.toLocaleLowerCase().includes(query));
    return {
      items: matching.slice(0, MAX_RENDERED_OPTIONS),
      matchingCount: matching.length,
    };
  }, [deferredSearch, options]);

  const toggle = (value: string, nextChecked: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      if (nextChecked) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  return (
    <details className="group border-b border-zinc-100" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-bold text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pink-500 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          {label}
          {checked.size > 0 && <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-black text-pink-700">{checked.size}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      {[...checked].map((value) => {
        const option = optionsByValue.get(value);
        return <input key={value} type="hidden" name={name} value={option?.submitValue ?? option?.value ?? value} />;
      })}
      <div className="pb-4">
        {options.length >= 7 && (
          <label className="flex h-10 items-center rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 transition focus-within:border-pink-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-pink-100">
            <Search className="size-4 shrink-0 text-zinc-400" />
            <span className="sr-only">Search {label}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} autoComplete="off" className="min-w-0 flex-1 bg-transparent px-2 text-xs text-zinc-800 outline-none placeholder:text-zinc-400" />
          </label>
        )}
        <div className={`${options.length >= 7 ? "mt-2" : ""} max-h-56 space-y-0.5 overflow-y-auto overscroll-contain pr-1`}>
          {visible.items.map((option) => {
            const isChecked = checked.has(option.value);
            return (
              <label key={`${option.value}:${option.submitValue ?? option.value}`} data-filter-option={option.value} className={`group/option flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm transition ${isChecked ? "bg-pink-50 font-semibold text-pink-900" : "text-zinc-700 hover:bg-pink-50/70 hover:text-zinc-950"}`}>
                <span className={`grid size-5 shrink-0 place-items-center rounded-md border transition ${isChecked ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-300 bg-white text-transparent group-hover/option:border-pink-300"}`}>
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                <input type="checkbox" checked={isChecked} onChange={(event) => toggle(option.value, event.target.checked)} className="sr-only" />
                {option.hex && <span className="size-4 shrink-0 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: option.hex }} />}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </label>
            );
          })}
          {visible.matchingCount === 0 && <p className="rounded-xl bg-zinc-50 py-4 text-center text-xs text-zinc-400">No matching options</p>}
        </div>
        {visible.matchingCount > visible.items.length && <p className="mt-2 px-2 text-[10px] leading-4 text-zinc-400" aria-live="polite">Showing {visible.items.length.toLocaleString("en-IN")} of {visible.matchingCount.toLocaleString("en-IN")} matches. Search to find a specific {label.toLowerCase()}.</p>}
      </div>
    </details>
  );
}
