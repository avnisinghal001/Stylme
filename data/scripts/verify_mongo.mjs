#!/usr/bin/env node
// Read-only verification of the live StylMe seed using the root environment.

import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import { MongoClient } from "mongodb";

const projectRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const envPath = resolve(valueOf("--env-file", resolve(projectRoot, ".env")));
const mongoUriKey = String(valueOf("--mongo-uri-key", "MONGODB_URL")).trim();
const processedPath = resolve(valueOf("--input", resolve(projectRoot, "data/processed/processed.csv")));
const validationPath = resolve(valueOf("--validation", resolve(projectRoot, "data/processed/validation_report.json")));
const requiredCategory = String(valueOf("--required-category", "")).trim();
const cataloguePolicy = String(valueOf("--policy", "")).trim();
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1] ? resolve(process.argv[outputIndex + 1]) : null;
const excludedProductTypes = new Set([
  "baby-sleeping-bag", "bath-robe", "boxers", "bra", "briefs", "camisoles", "corset",
  "innerwear-vests", "lingerie-accessories", "lingerie-set", "lounge-pants", "lounge-shorts",
  "lounge-tshirts", "night-suits", "nightdress", "pyjamas", "robe", "shapewear", "sleepsuit",
  "slips", "socks", "stockings", "swim-bottoms", "swim-tops", "swimwear", "swimwear-accessories",
  "swimwear-cover-up-bottom", "swimwear-cover-up-top", "thermal-bottoms", "thermal-set", "thermal-tops", "trunk",
]);
const forbiddenText = /(?:^|[^a-z0-9])(?:bra|bralette|panty|panties|lingerie|underwear|undergarment|briefs?|trunks?|boxers?|shapewear|innerwear|camisoles?|corsets?|sleepwear|nightwear|nightdress|swimwear|bikini|stockings?|socks?|thermals?)(?=$|[^a-z0-9])/i;

function isPolicyExcluded(product) {
  const productType = String(product.product_type_key ?? "").toLowerCase();
  const text = [productType.replaceAll("-", " "), product.title, product.source_url].join(" ").toLowerCase();
  return excludedProductTypes.has(productType) || forbiddenText.test(text);
}

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[line.slice(0, index).trim()] = value;
  }
  return values;
}

function firstConfigured(fileEnv, keys) {
  for (const key of keys) {
    const value = String(process.env[key] ?? fileEnv[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

async function sumArrayLengths(collection, field, match = {}) {
  const [result] = await collection.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $size: { $ifNull: [`$${field}`, []] } } } } },
  ]).toArray();
  return result?.total ?? 0;
}

async function* csvRows(path) {
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: false }));
  for await (const row of parser) yield row;
}

async function main() {
  const fileEnv = readEnv(envPath);
  const uri = firstConfigured(fileEnv, mongoUriKey === "MONGODB_URL" ? [mongoUriKey, "MONGODB_URI"] : [mongoUriKey]);
  const databaseName = firstConfigured(fileEnv, ["MONGODB_DB_NAME", "DATABASE_NAME"]) || "StylMe";
  if (!uri) throw new Error(`${mongoUriKey} is required in ${envPath}`);
  const expected = JSON.parse(readFileSync(validationPath, "utf8"));
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  try {
    await client.connect();
    const db = client.db(databaseName);
    const products = db.collection("products");
    const offers = db.collection("seller_offers");
    const locations = db.collection("seller_locations");
    const pincodes = db.collection("pincode_geos");
    const cache = db.collection("available_filter_cache");
    const managedProductFilter = { source: { $in: ["myntra_detailed", "myntra_large"] } };
    const managedProductIds = await products.distinct("_id", managedProductFilter);
    const managedOfferFilter = { product_id: { $in: managedProductIds } };
    const metadataFields = await db.collection("metadata_fields").find(
      { status: { $ne: "inactive" } },
      { projection: { _id: 0, key: 1, storage: 1, options: 1 } },
    ).toArray();
    const controlledMetadata = new Map(
      metadataFields
        .filter((field) => field.storage === "product_metadata")
        .map((field) => [field.key, new Set((field.options ?? []).map((option) => typeof option === "object" ? option.key : option))]),
    );
    const counts = {
      products: await products.countDocuments(managedProductFilter),
      offers: await offers.countDocuments(managedOfferFilter),
      brands: await db.collection("brands").countDocuments({ "metadata.pipeline.key": { $exists: true } }),
      sellers: await db.collection("sellers").countDocuments({ "metadata.pipeline.key": { $exists: true } }),
      sellerUsers: await db.collection("users").countDocuments({ "metadata.pipeline.sellerKey": { $exists: true } }),
      sellerLocations: await locations.countDocuments({ "metadata.pipeline.key": { $exists: true } }),
      resolvedLocations: await locations.countDocuments({ geocode_resolved: true }),
      colors: await db.collection("colors").countDocuments({ key: { $type: "string" } }),
      metadataFields: await db.collection("metadata_fields").countDocuments({ key: { $type: "string" } }),
      variants: await sumArrayLengths(offers, "variants", managedOfferFilter),
      inventoryEntries: await sumArrayLengths(offers, "inventory", managedOfferFilter),
    };
    const productMedia = new Map();
    let forbiddenProducts = 0;
    let productsWithUnknownMetadataFields = 0;
    let productsWithUnknownMetadataValues = 0;
    const cohortCounts = { festive: 0, genZ: 0, genAlpha: 0, deepPersonalization: 0 };
    for await (const product of products.find(
      managedProductFilter,
      { projection: { source: 1, source_product_id: 1, source_url: 1, title: 1, product_type_key: 1, cover_image_url: 1, media: 1, metadata: 1 } },
    )) {
      productMedia.set(`${product.source}:${product.source_product_id}`, {
        cover: product.cover_image_url ?? "",
        urls: (product.media ?? []).map((item) => item.url),
      });
      if (cataloguePolicy && isPolicyExcluded(product)) forbiddenProducts += 1;
      const metadata = product.metadata ?? {};
      let unknownField = false;
      let unknownValue = false;
      for (const [key, values] of Object.entries(metadata)) {
        const allowed = controlledMetadata.get(key);
        if (!allowed) {
          unknownField = true;
          continue;
        }
        if (!Array.isArray(values) || values.some((value) => !allowed.has(value))) unknownValue = true;
      }
      if (unknownField) productsWithUnknownMetadataFields += 1;
      if (unknownValue) productsWithUnknownMetadataValues += 1;
      if ((metadata.personalization_segment ?? []).includes("festive-first")) cohortCounts.festive += 1;
      if ((metadata.generation ?? []).includes("gen-z")) cohortCounts.genZ += 1;
      if ((metadata.generation ?? []).includes("gen-alpha")) cohortCounts.genAlpha += 1;
      if (["personalization_segment", "aesthetic", "dress_code", "body_fit_preference"].every((key) => (metadata[key] ?? []).length)) {
        cohortCounts.deepPersonalization += 1;
      }
    }
    let sourceImageUrlMismatches = 0;
    for await (const row of csvRows(processedPath)) {
      const actual = productMedia.get(`${row.source}:${row.source_product_id}`);
      const expectedUrls = JSON.parse(row.media_json).map((item) => item.url);
      if (!actual || actual.cover !== row.cover_image_url || JSON.stringify(actual.urls) !== JSON.stringify(expectedUrls)) {
        sourceImageUrlMismatches += 1;
      }
    }
    const integrity = {
      productsMissingMedia: await products.countDocuments({ ...managedProductFilter, $or: [{ media: { $size: 0 } }, { cover_image_url: null }] }),
      offersMissingVariants: await offers.countDocuments({ ...managedOfferFilter, "variants.0": { $exists: false } }),
      offersMissingInventory: await offers.countDocuments({ ...managedOfferFilter, "inventory.0": { $exists: false } }),
      offersMissingFitEnvelope: await offers.countDocuments({ ...managedOfferFilter, "fit_bounds.applicable": { $type: "bool" } }) === counts.offers ? 0 : 1,
      offersMissingAgeEnvelope: await offers.countDocuments({ ...managedOfferFilter, "age_bounds.applicable": { $type: "bool" } }) === counts.offers ? 0 : 1,
      productsMissingGeneration: await products.countDocuments({ ...managedProductFilter, "metadata.generation.0": { $exists: false } }),
      productsMissingTrendSignal: await products.countDocuments({ ...managedProductFilter, "metadata.trend_signal.0": { $exists: false } }),
      productsMissingPersonalizationSegment: cataloguePolicy ? await products.countDocuments({ ...managedProductFilter, "metadata.personalization_segment.0": { $exists: false } }) : 0,
      productsMissingAesthetic: cataloguePolicy ? await products.countDocuments({ ...managedProductFilter, "metadata.aesthetic.0": { $exists: false } }) : 0,
      productsMissingDressCode: cataloguePolicy ? await products.countDocuments({ ...managedProductFilter, "metadata.dress_code.0": { $exists: false } }) : 0,
      productsMissingBodyFitPreference: cataloguePolicy ? await products.countDocuments({ ...managedProductFilter, "metadata.body_fit_preference.0": { $exists: false } }) : 0,
      forbiddenProducts,
      productsWithUnknownMetadataFields,
      productsWithUnknownMetadataValues,
      nonRequiredCategoryProducts: requiredCategory
        ? await products.countDocuments({ ...managedProductFilter, category_key: { $ne: requiredCategory } })
        : 0,
      unresolvedLocations: counts.sellerLocations - counts.resolvedLocations,
      sourceImageUrlMismatches,
    };
    const cacheIndexes = await cache.listIndexes().toArray();
    const locationIndexes = await locations.listIndexes().toArray();
    const pincodeIndexes = await pincodes.listIndexes().toArray();
    const indexes = {
      fiveMinuteFilterCacheTtl: cacheIndexes.some((index) => index.key?.expires_at === 1 && index.expireAfterSeconds === 0),
      sellerLocationGeo: locationIndexes.some((index) => index.key?.geo_point === "2dsphere"),
      pincodeGeo: pincodeIndexes.some((index) => index.key?.geo_point === "2dsphere"),
    };
    const expectedCounts = {
      products: expected.rows,
      offers: expected.rows,
      variants: expected.ingestionCounts.variants,
      inventoryEntries: expected.ingestionCounts.inventoryEntries,
    };
    const countMismatches = Object.fromEntries(Object.entries(expectedCounts).filter(([key, value]) => counts[key] !== value).map(([key, value]) => [key, { expected: value, actual: counts[key] }]));
    const valid = !Object.keys(countMismatches).length && Object.values(integrity).every((value) => value === 0) && Object.values(indexes).every(Boolean);
    const report = { valid, database: databaseName, uriVariable: mongoUriKey, requiredCategory: requiredCategory || null, cataloguePolicy: cataloguePolicy || null, counts, cohortCounts, integrity, indexes, countMismatches };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) writeFileSync(outputPath, serialized, "utf8");
    console.log(serialized.trim());
    if (!valid) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main();
