"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createContext, useContext, useState, useTransition, type FormEvent, type ReactNode } from "react";

const CatalogFilterPendingContext = createContext(false);

type SubmissionState = {
  appliedStateKey: string;
  pending: boolean;
};

function canonicalQuery(params: URLSearchParams) {
  return [...new Set(params.keys())]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((key) => params.getAll(key).map((value) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`))
    .join("&");
}

export function CatalogFilterForm({ action, appliedStateKey, externalPending = false, children }: { action: string; appliedStateKey: string; externalPending?: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [transitionPending, startTransition] = useTransition();
  const [submission, setSubmission] = useState<SubmissionState>({ appliedStateKey, pending: false });
  if (submission.appliedStateKey !== appliedStateKey) {
    setSubmission({ appliedStateKey, pending: false });
  }
  const isSubmitting = submission.appliedStateKey === appliedStateKey && submission.pending;
  const isPending = isSubmitting || transitionPending || externalPending;

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const formData = new FormData(event.currentTarget);

    formData.forEach((rawValue, key) => {
      if (typeof rawValue !== "string") return;
      const value = rawValue.trim();
      if (value) params.append(key, value);
    });

    window.dispatchEvent(new Event("catalog-filter-submit"));
    const query = params.toString();
    const target = query ? `${action}?${query}` : action;
    const currentParams = new URLSearchParams(searchParams.toString());
    if (!currentParams.has("sort")) currentParams.set("sort", "recommended");
    if (pathname === action && canonicalQuery(params) === canonicalQuery(currentParams)) return;

    setSubmission({ appliedStateKey, pending: true });
    startTransition(() => router.push(target));
  };

  return (
    <CatalogFilterPendingContext.Provider value={isPending}>
      <form action={action} onSubmit={applyFilters} aria-busy={isPending} className="flex h-full min-h-0 max-h-full w-full flex-col overflow-hidden" aria-label="Product filters">
        {children}
      </form>
    </CatalogFilterPendingContext.Provider>
  );
}

export function CatalogFilterSubmitButton() {
  const isPending = useContext(CatalogFilterPendingContext);

  return (
    <button
      type="submit"
      disabled={isPending}
      aria-label={isPending ? "Applying filters" : undefined}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-pink-600 px-4 text-sm font-black text-white shadow-[0_12px_28px_-14px_rgba(219,39,119,0.9)] transition hover:bg-pink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-pink-500"
    >
      {isPending ? (
        <>
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span aria-live="polite">Applying filters…</span>
        </>
      ) : (
        <>
          Apply filters <ArrowRight className="size-4" aria-hidden="true" />
        </>
      )}
    </button>
  );
}
