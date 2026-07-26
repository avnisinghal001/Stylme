"use client";

import { useEffect } from "react";

// The server already returned the compiled result page. Keep the controlled
// filters visible/shareable without triggering another navigation or request.
export function SearchIntentClient({ queryParams }: { queryParams?: Record<string, unknown> }) {
  useEffect(() => {
    if (!queryParams) return;
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(queryParams)) {
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value !== null && value !== undefined && value !== "") params.append(key, String(value));
      }
    }
    window.history.replaceState(window.history.state, "", `/search?${params.toString()}`);
  }, [queryParams]);
  return null;
}
