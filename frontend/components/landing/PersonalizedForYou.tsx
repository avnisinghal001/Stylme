"use client";

import { useEffect, useMemo, useState } from "react";

import { ProductSection } from "@/components/landing/ProductSection";
import { getPersonalizedProducts, type PersonalizedCatalogProduct } from "@/lib/api/personalization";
import { useAuth } from "@/providers/AuthProvider";
import { compatibleGenderKeys, measurementBand } from "@/lib/profile-bands";

export function PersonalizedForYou() {
  const { user, isLoading } = useAuth();
  const [products, setProducts] = useState<PersonalizedCatalogProduct[]>([]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getPersonalizedProducts().then((result) => { if (active) setProducts(result.items); }).catch(() => { if (active) setProducts([]); });
    return () => { active = false; };
  }, [user]);

  const href = useMemo(() => {
    if (!user) return "/products";
    const params = new URLSearchParams();
    const { age, heightCm, weightKg } = user.profileSignals ?? {};
    compatibleGenderKeys(user.genderKeys ?? [], age).forEach((value) => params.append("gender", value));
    if (age !== null && age !== undefined) { params.set("minAge", String(age)); params.set("maxAge", String(age)); }
    const heightBand = measurementBand(heightCm, 15); const weightBand = measurementBand(weightKg, 10);
    if (heightBand) { params.set("minHeightCm", String(heightBand.min)); params.set("maxHeightCm", String(heightBand.max)); }
    if (weightBand) { params.set("minWeightKg", String(weightBand.min)); params.set("maxWeightKg", String(weightBand.max)); }
    return `/products?${params.toString()}`;
  }, [user]);

  if (isLoading || !user || !products.length) return null;
  const genderLabel = user.genderKeys?.length ? user.genderKeys.join(" + ").replaceAll("-", " ") : "all departments";
  return <ProductSection eyebrow="Your StylMe profile" title={`Picked for ${genderLabel}`} description="Based on your saved fit, style and colour choices, with more ways to explore." products={products} href={href} tinted />;
}
