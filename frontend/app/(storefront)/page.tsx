import type { Metadata } from "next";

import { StorefrontHomeClient } from "@/components/landing/StorefrontHomeClient";

export const metadata: Metadata = { title: "StylMe — Say the vibe. Find the look.", description: "Find fashion for your mood, moment and fastest available delivery." };

export default function StorefrontHomePage() {
  return <StorefrontHomeClient />;
}
