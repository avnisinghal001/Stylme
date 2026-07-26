import type { CatalogQuery, CatalogSort } from "@/types/catalog";

export type StorefrontSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function many(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.trim()).filter(Boolean);
}

export function parseCatalogQuery(params: StorefrontSearchParams): CatalogQuery {
  const rawSort = one(params.sort);
  const sorts: CatalogSort[] = ["recommended", "newest", "price-low", "price-high", "rating"];
  return {
    page: Math.max(1, positiveNumber(one(params.page)) ?? 1),
    pageSize: 12,
    query: one(params.q),
    lexicalQuery: one(params.lexical),
    brand: many(params.brand),
    category: many(params.category),
    productType: many(params.productType),
    colour: many(params.colour),
    size: many(params.size),
    gender: many(params.gender),
    profileGender: many(params.profileGender),
    profileAge: positiveNumber(one(params.profileAge)),
    profileHeightCm: positiveNumber(one(params.profileHeightCm)),
    profileWeightKg: positiveNumber(one(params.profileWeightKg)),
    metadata: many(params.meta).reduce<Record<string, string[]>>((result, entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) return result;
      const key = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      if (key && value) result[key] = [...new Set([...(result[key] ?? []), value])];
      return result;
    }, {}),
    softMetadata: many(params.softMeta).reduce<Record<string, string[]>>((result, entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) return result;
      const key = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      if (key && value) result[key] = [...new Set([...(result[key] ?? []), value])];
      return result;
    }, {}),
    minPrice: positiveNumber(one(params.minPrice)),
    maxPrice: positiveNumber(one(params.maxPrice)),
    minAge: positiveNumber(one(params.minAge)),
    maxAge: positiveNumber(one(params.maxAge)),
    minHeightCm: positiveNumber(one(params.minHeightCm)),
    maxHeightCm: positiveNumber(one(params.maxHeightCm)),
    minWeightKg: positiveNumber(one(params.minWeightKg)),
    maxWeightKg: positiveNumber(one(params.maxWeightKg)),
    sort: sorts.includes(rawSort as CatalogSort) ? (rawSort as CatalogSort) : "recommended",
    pincode: one(params.pincode)?.replace(/\D/g, "").slice(0, 6),
    swoopStyl: one(params.swoopstyl) === "true",
    intentParsed: one(params.intent) === "1",
    intentSource: one(params.intentSource),
  };
}

export function queryRecord(query: CatalogQuery): Record<string, string | string[] | undefined> {
  return {
    q: query.query,
    lexical: query.lexicalQuery,
    brand: query.brand,
    category: query.category,
    productType: query.productType,
    colour: query.colour,
    size: query.size,
    gender: query.gender,
    profileGender: query.profileGender,
    profileAge: query.profileAge === undefined ? undefined : String(query.profileAge),
    profileHeightCm: query.profileHeightCm === undefined ? undefined : String(query.profileHeightCm),
    profileWeightKg: query.profileWeightKg === undefined ? undefined : String(query.profileWeightKg),
    meta: Object.entries(query.metadata ?? {}).flatMap(([key, values]) => values.map((value) => `${key}:${value}`)),
    softMeta: Object.entries(query.softMetadata ?? {}).flatMap(([key, values]) => values.map((value) => `${key}:${value}`)),
    minPrice: query.minPrice === undefined ? undefined : String(query.minPrice),
    maxPrice: query.maxPrice === undefined ? undefined : String(query.maxPrice),
    minAge: query.minAge === undefined ? undefined : String(query.minAge),
    maxAge: query.maxAge === undefined ? undefined : String(query.maxAge),
    minHeightCm: query.minHeightCm === undefined ? undefined : String(query.minHeightCm),
    maxHeightCm: query.maxHeightCm === undefined ? undefined : String(query.maxHeightCm),
    minWeightKg: query.minWeightKg === undefined ? undefined : String(query.minWeightKg),
    maxWeightKg: query.maxWeightKg === undefined ? undefined : String(query.maxWeightKg),
    sort: query.sort,
    pincode: query.pincode,
    swoopstyl: query.swoopStyl ? "true" : undefined,
    intent: query.intentParsed ? "1" : undefined,
    intentSource: query.intentSource,
  };
}
