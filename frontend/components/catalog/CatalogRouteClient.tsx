"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { CatalogBrowser } from "@/components/catalog/CatalogBrowser";
import { parseCatalogQuery, type StorefrontSearchParams } from "@/components/catalog/catalog-query";

function searchParamsRecord(params: Readonly<URLSearchParams>): StorefrontSearchParams {
  const result: StorefrontSearchParams = {};
  params.forEach((value, key) => {
    const current = result[key];
    result[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  });
  return result;
}

function useCatalogUrlQuery() {
  const searchParams = useSearchParams();
  return useMemo(() => parseCatalogQuery(searchParamsRecord(searchParams)), [searchParams]);
}

export function ProductsRouteClient() {
  const query = useCatalogUrlQuery();
  return (
    <CatalogBrowser
      query={query}
      pathname="/products"
      badge={query.swoopStyl ? "SwoopStyl one-day zone" : undefined}
      title={query.swoopStyl && query.pincode ? `Nearby styles for ${query.pincode}` : query.category?.length ? `${query.category.join(" + ")} styles` : "Find your next look"}
      description={query.swoopStyl ? "One-day styles available near your pincode, with the fastest options first." : "Explore brands, occasions, colours and fits."}
    />
  );
}

export function SearchRouteClient() {
  const query = useCatalogUrlQuery();
  const phrase = query.query?.trim();
  return (
    <CatalogBrowser
      query={query}
      pathname="/search"
      advanced={Boolean(phrase)}
      badge={query.intentParsed ? "Picked for your search" : "Explore styles"}
      title={phrase ? <>Results for <span className="text-pink-600">“{phrase}”</span></> : "What do you want to wear?"}
      description={phrase ? "We understood the look, mood, budget and delivery details in your words, then brought the closest styles to the top." : "Try a mood, occasion, city, activity, colour, fit, budget or one-day delivery need in your own words."}
    />
  );
}
