import type { Metadata } from "next";

import { ProductRouteClient } from "@/components/storefront/ProductRouteClient";

export const metadata: Metadata = { title: "Product details", description: "See the style, price, available variants and delivery information." };

export default function ProductPage() {
  return <ProductRouteClient />;
}
