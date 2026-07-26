"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const subscribeToHydration = () => () => undefined;

export function CatalogFilterDrawer({ activeCount, resultCount, children }: {
  activeCount: number;
  resultCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.setTimeout(() => triggerRef.current?.focus(), 0);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("catalog-filter-submit", closeDrawer);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("catalog-filter-submit", closeDrawer);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <div className="sticky top-16 z-40 -mx-4 border-y border-pink-100 bg-white/95 px-4 py-3 shadow-[0_12px_30px_-28px_rgba(24,17,20,0.45)] backdrop-blur-xl sm:-mx-6 sm:px-6">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex h-12 w-full items-center justify-between rounded-2xl border border-pink-200 bg-white px-4 text-left shadow-[0_8px_24px_-18px_rgba(190,24,93,0.5)] transition hover:border-pink-300 hover:bg-pink-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-2.5 text-sm font-black text-zinc-950">
            <span className="grid size-8 place-items-center rounded-xl bg-pink-600 text-white"><SlidersHorizontal className="size-4" /></span>
            Filter & sort
            {activeCount > 0 && <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[11px] text-pink-700">{activeCount}</span>}
          </span>
          <span className="text-xs font-semibold text-zinc-500">{resultCount.toLocaleString("en-IN")} {resultCount === 1 ? "style" : "styles"}</span>
        </button>
      </div>

      {mounted && createPortal(
        <div className={open ? "fixed inset-0 isolate z-[80] h-[100dvh] overflow-hidden" : "hidden"} role="presentation">
          <button type="button" aria-label="Close filters" onClick={closeDrawer} className="absolute inset-0 bg-zinc-950/45 backdrop-blur-sm" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-y-0 right-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-300"
          >
            <header className="flex min-h-18 shrink-0 items-center justify-between border-b border-pink-100 px-5 pt-[env(safe-area-inset-top)]">
              <div>
                <h2 id={titleId} className="text-lg font-black tracking-tight text-zinc-950">Filter & sort</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Refine {resultCount.toLocaleString("en-IN")} matching {resultCount === 1 ? "style" : "styles"}</p>
              </div>
              <button ref={closeRef} type="button" onClick={closeDrawer} aria-label="Close filters" className="grid size-11 place-items-center rounded-full border border-zinc-200 text-zinc-600 transition hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500">
                <X className="size-5" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-[env(safe-area-inset-bottom)]">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
