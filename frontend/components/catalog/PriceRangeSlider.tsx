"use client";

import { useState } from "react";

export function PriceRangeSlider({ minimum, maximum, initialMinimum, initialMaximum }: {
  minimum: number;
  maximum: number;
  initialMinimum?: number;
  initialMaximum?: number;
}) {
  const [enabled, setEnabled] = useState(initialMinimum !== undefined || initialMaximum !== undefined);
  const [low, setLow] = useState(Math.max(minimum, initialMinimum ?? minimum));
  const [high, setHigh] = useState(Math.min(maximum, initialMaximum ?? maximum));
  const step = Math.max(1, Math.round((maximum - minimum) / 200));

  return (
    <fieldset className="border-b border-zinc-100 py-4">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold text-zinc-900">
        <span>Price range</span>
        <span className={`relative h-6 w-11 rounded-full transition ${enabled ? "bg-pink-600" : "bg-zinc-200"}`}>
          <span className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="sr-only" />
        </span>
      </label>
      <div className={`mt-4 transition ${enabled ? "opacity-100" : "pointer-events-none opacity-45"}`} aria-hidden={!enabled}>
        <div className="flex items-center justify-between gap-3 text-sm font-black text-zinc-950">
          <span className="rounded-lg bg-pink-50 px-2.5 py-1.5 text-pink-700">₹{low.toLocaleString("en-IN")}</span>
          <span className="h-px flex-1 bg-zinc-200" />
          <span className="rounded-lg bg-pink-50 px-2.5 py-1.5 text-pink-700">₹{high.toLocaleString("en-IN")}</span>
        </div>
        <div className="relative mt-3 h-7">
          <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-pink-100" />
          <input aria-label="Minimum price" name="minPrice" type="range" min={minimum} max={maximum} step={step} value={low} disabled={!enabled} onChange={(event) => setLow(Math.min(Number(event.target.value), high))} className="catalog-range pointer-events-none absolute inset-x-0 top-0 h-7 w-full appearance-none bg-transparent accent-pink-600" />
          <input aria-label="Maximum price" name="maxPrice" type="range" min={minimum} max={maximum} step={step} value={high} disabled={!enabled} onChange={(event) => setHigh(Math.max(Number(event.target.value), low))} className="catalog-range pointer-events-none absolute inset-x-0 top-0 h-7 w-full appearance-none bg-transparent accent-pink-600" />
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">Turn off to see styles at every price.</p>
      </div>
    </fieldset>
  );
}
