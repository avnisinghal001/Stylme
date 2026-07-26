"use client";

import { apiRequest } from "@/lib/api/client";
import type { CatalogProduct } from "@/types/catalog";

type UnknownRecord = Record<string, unknown>;

export type PersonalizedCatalogProduct = CatalogProduct & {
  swoopStyl?: { distanceKm?: number; profileMatch?: number };
};

export type PersonalizationSummary = {
  selectedGenderKeys: string[];
  genderKeys: string[];
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  heightBand?: { min: number; max: number } | null;
  weightBand?: { min: number; max: number } | null;
  pincode?: string | null;
  swoopStyl: boolean;
  genderMode: "profile" | "wildcard";
  rankingRule: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeProduct(value: unknown): PersonalizedCatalogProduct | null {
  const raw = record(value);
  if (!raw.id || typeof raw.title !== "string") return null;
  const brand = record(raw.brand);
  const price = record(raw.price);
  const rating = record(raw.rating);
  const metadata = Object.fromEntries(
    Object.entries(record(raw.metadata)).map(([key, values]) => [key, strings(values)]),
  );
  const palette = Array.isArray(raw.colorPalette) ? raw.colorPalette.map(record) : [];
  const media = Array.isArray(raw.media) ? raw.media.map(record) : [];
  const swoopStyl = record(raw.swoopStyl);
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? raw.id),
    title: raw.title,
    brand: typeof brand.name === "string" ? brand.name : "StylMe",
    shortDescription: "",
    description: "",
    category: String(raw.categoryKey ?? "fashion"),
    productType: String(raw.productTypeKey ?? "style"),
    genders: strings(raw.genderKeys),
    imageUrl: typeof raw.coverImageUrl === "string" ? raw.coverImageUrl : null,
    gallery: media.map((item) => item.url).filter((url): url is string => typeof url === "string"),
    pricePaise: number(price.salePricePaise),
    mrpPaise: number(price.mrpPaise, number(price.salePricePaise)),
    discountPercent: number(price.discountPercent),
    rating: number(rating.average),
    ratingCount: number(rating.count),
    colour: palette.length && typeof palette[0].hex === "string" ? palette[0].hex : "Multi",
    colourFamilies: [...new Set(palette.flatMap((item) => strings(item.families)))],
    sizes: [],
    tags: [...new Set(Object.values(metadata).flat())],
    sellerName: null,
    deliveryLabel: typeof raw.deliveryLabel === "string" ? raw.deliveryLabel : null,
    swoopStylEligible: Boolean(raw.swoopStylEligible),
    metadata,
    offers: [],
    swoopStyl: Object.keys(swoopStyl).length ? {
      distanceKm: number(swoopStyl.distanceKm, Number.NaN),
      profileMatch: number(swoopStyl.profileMatch, 0),
    } : undefined,
  };
}

export async function getPersonalizedProducts({ pincode, swoopStyl = false, limit = 8 }: { pincode?: string; swoopStyl?: boolean; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (pincode) params.set("pincode", pincode);
  if (swoopStyl) params.set("swoopstyl", "true");
  const payload = await apiRequest<{ items?: unknown[]; total?: number; personalization?: PersonalizationSummary }>(`/home/personalized?${params.toString()}`);
  return {
    items: (payload.items ?? []).map(normalizeProduct).filter((item): item is PersonalizedCatalogProduct => item !== null),
    total: number(payload.total),
    personalization: payload.personalization,
  };
}
