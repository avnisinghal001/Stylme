import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchRouteClient } from "@/components/catalog/CatalogRouteClient";

export const metadata: Metadata = { title: "Find your style", description: "Describe the look, mood, occasion, budget or delivery speed you want." };

export default function SearchPage() {
  return <Suspense fallback={<div className="mx-auto grid min-h-[60dvh] w-full max-w-[90rem] place-items-center px-6 text-sm font-bold text-pink-700">Preparing search…</div>}><SearchRouteClient /></Suspense>;
}
