import type { Metadata } from "next";
import { Suspense } from "react";

import { ProductsRouteClient } from "@/components/catalog/CatalogRouteClient";

export const metadata: Metadata = { title: "Shop fashion", description: "Browse fashion by category, brand, colour, size and price on StylMe." };

export default function ProductsPage() {
  return <Suspense fallback={<CatalogRouteFallback label="Loading the catalogue…" />}><ProductsRouteClient /></Suspense>;
}

function CatalogRouteFallback({ label }: { label: string }) {
  return <div className="mx-auto grid min-h-[60dvh] w-full max-w-[90rem] place-items-center px-6 text-sm font-bold text-pink-700">{label}</div>;
}
