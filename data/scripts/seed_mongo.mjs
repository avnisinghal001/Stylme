#!/usr/bin/env node
// Node/OpenSSL fallback for idempotent MongoDB seeding on machines whose system
// Python TLS stack cannot connect to Atlas. FastAPI/Beanie remains the app backend.

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const valuesOf = (flag) => args.flatMap((value, index) => value === flag && args[index + 1] ? [args[index + 1]] : []);

const projectRoot = resolve(import.meta.dirname, "../..");
const inputPath = resolve(valueOf("--input", resolve(projectRoot, "data/processed/processed.csv")));
const seedDir = resolve(valueOf("--seed-dir", resolve(projectRoot, "data/processed/seed")));
const sharedSeedDir = resolve(valueOf("--shared-seed-dir", resolve(projectRoot, "data/processed/seed")));
const supplementalSeedDirs = valuesOf("--supplemental-seed-dir").map((value) => resolve(value));
const requestedImportKey = String(valueOf("--import-key", "")).trim();
const validationPath = resolve(valueOf("--validation", resolve(projectRoot, "data/processed/validation_report.json")));
const envPath = resolve(valueOf("--env-file", resolve(projectRoot, ".env")));
const mongoUriKey = String(valueOf("--mongo-uri-key", "MONGODB_URL")).trim();
const batchSize = Number(valueOf("--batch-size", "500"));
const writeConcurrency = Math.max(1, Math.min(8, Number(valueOf("--write-concurrency", "4")) || 4));
const pruneManagedCatalog = has("--prune-managed-catalog");
const pruneOnly = has("--prune-only");

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key) values[key] = value;
  }
  return values;
}

function firstConfigured(fileEnv, keys) {
  for (const key of keys) {
    const value = String(process.env[key] ?? fileEnv[key] ?? "").trim();
    if (value) return { key, value };
  }
  return { key: null, value: "" };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function mergeSeedRecords(groups) {
  const records = new Map();
  for (const group of groups) {
    for (const item of group) {
      const previous = records.get(item.key);
      if (!previous) {
        records.set(item.key, item);
        continue;
      }
      records.set(item.key, {
        ...previous,
        ...item,
        aliases: [...new Set([...(previous.aliases ?? []), ...(item.aliases ?? [])])],
        sources: [...new Set([...(previous.sources ?? []), ...(item.sources ?? [])])],
        dedupe_methods: [...new Set([...(previous.dedupe_methods ?? []), ...(item.dedupe_methods ?? [])])],
        brand_keys: [...new Set([...(previous.brand_keys ?? []), ...(item.brand_keys ?? [])])],
      });
    }
  }
  return [...records.values()];
}

function locationsFor(directory) {
  const geocoded = resolve(directory, "seller_locations.geocoded.jsonl");
  return readJsonl(existsSync(geocoded) ? geocoded : resolve(directory, "seller_locations.jsonl"));
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").replaceAll("&", " and ").replace(/[®™©]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function stableHex(value) {
  // Stable FNV-1a-style identifier is sufficient for deterministic seed emails.
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function boolValue(value) {
  return ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
}

async function bulk(collection, operations) {
  if (!operations.length) return;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await collection.bulkWrite(operations, { ordered: false });
      return;
    } catch (error) {
      const labels = error?.errorLabelSet ?? new Set();
      const retryable = labels.has("RetryableWriteError")
        || labels.has("ResetPool")
        || labels.has("HandshakeError")
        || [6, 7, 89, 91, 189, 9001].includes(error?.code)
        || /network|timed out|connection|server selection/i.test(String(error?.message ?? error));
      if (!retryable || attempt === maxAttempts) throw error;
      const delayMs = Math.min(8_000, 1_000 * (2 ** (attempt - 1)));
      console.error(`[seed] transient MongoDB write failure; retrying batch (${attempt}/${maxAttempts}) in ${delayMs}ms`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
}

async function pruneObsoleteManagedCatalog(db, inputProductKeys) {
  const obsoleteIds = [];
  for await (const product of db.collection("products").find(
    { source: { $in: ["myntra_detailed", "myntra_large"] } },
    { projection: { source: 1, source_product_id: 1 } },
  )) {
    if (!inputProductKeys.has(`${product.source}:${product.source_product_id}`)) obsoleteIds.push(product._id);
  }
  let prunedOffers = 0;
  let prunedProducts = 0;
  for (let index = 0; index < obsoleteIds.length; index += batchSize) {
    const ids = obsoleteIds.slice(index, index + batchSize);
    prunedOffers += (await db.collection("seller_offers").deleteMany({ product_id: { $in: ids } })).deletedCount;
    prunedProducts += (await db.collection("products").deleteMany({ _id: { $in: ids } })).deletedCount;
  }
  return { prunedProducts, prunedOffers };
}

async function* csvRows(path) {
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: false }));
  for await (const row of parser) yield row;
}

async function ensureIndexes(db) {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ phone_e164: 1 }, { unique: true, partialFilterExpression: { phone_e164: { $type: "string" } } });
  await db.collection("users").createIndex({ roles: 1, status: 1 });
  await db.collection("sellers").createIndex({ user_id: 1 }, { unique: true });
  await db.collection("sellers").createIndex({ slug: 1 }, { unique: true });
  await db.collection("sellers").createIndex({ status: 1 });
  await db.collection("sellers").createIndex(
    { status: 1, created_at: -1, _id: -1 },
    { name: "admin_sellers_status_created_v1" },
  );
  await db.collection("seller_locations").createIndex({ geo_point: "2dsphere" });
  await db.collection("seller_locations").createIndex({ seller_id: 1, status: 1 });
  await db.collection("seller_locations").createIndex({ pincode: 1, swoopstyl_enabled: 1, status: 1 });
  await db.collection("brands").createIndex({ normalized_name: 1 }, { unique: true });
  await db.collection("brands").createIndex({ slug: 1 }, { unique: true });
  await db.collection("brands").createIndex(
    { status: 1, name: 1 },
    { name: "active_brands_name_v1" },
  );
  await db.collection("colors").createIndex({ key: 1 }, { unique: true });
  await db.collection("colors").createIndex({ normalized_name: 1 }, { unique: true });
  await db.collection("colors").createIndex(
    { status: 1, name: 1 },
    { name: "active_colors_name_v1" },
  );
  await db.collection("metadata_fields").createIndex({ key: 1 }, { unique: true });
  await db.collection("search_intent_models").createIndex({ key: 1 }, { unique: true });
  await db.collection("pincode_geos").createIndex({ country_code: 1, pincode: 1 }, { unique: true });
  await db.collection("pincode_geos").createIndex({ geo_point: "2dsphere" });
  await db.collection("products").createIndex(
    { source: 1, source_product_id: 1 },
    { unique: true, partialFilterExpression: { source: { $type: "string" }, source_product_id: { $type: "string" } } },
  );
  await db.collection("products").createIndex({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } });
  await db.collection("products").createIndex({ status: 1, visibility: 1, category_key: 1, product_type_key: 1 });
  await db.collection("products").createIndex(
    { status: 1, visibility: 1, catalogue_eligible: 1, created_at: -1, _id: -1 },
    { name: "catalogue_newest_v1" },
  );
  await db.collection("products").createIndex(
    { status: 1, visibility: 1, catalogue_eligible: 1, "rating.count": -1, "rating.average": -1, _id: -1 },
    { name: "catalogue_relevance_v1" },
  );
  await db.collection("products").createIndex(
    { status: 1, visibility: 1, catalogue_eligible: 1, "rating.average": -1, "rating.count": -1, _id: -1 },
    { name: "catalogue_rating_v1" },
  );
  await db.collection("products").createIndex(
    { status: 1, visibility: 1, catalogue_eligible: 1, category_key: 1, "rating.average": -1, "rating.count": -1, _id: -1 },
    { name: "catalogue_related_rating_v1" },
  );
  await db.collection("products").createIndex(
    { status: 1, visibility: 1, catalogue_eligible: 1, catalogue_min_price_paise: 1, _id: -1 },
    { name: "catalogue_price_v1" },
  );
  await db.collection("products").createIndex({ search_text: "text" });
  await db.collection("products").createIndex({ "metadata.$**": 1 });
  await db.collection("seller_offers").createIndex({ offer_code: 1 }, { unique: true });
  await db.collection("seller_offers").createIndex({ product_id: 1, status: 1 });
  await db.collection("seller_offers").createIndex(
    { product_id: 1, status: 1, sale_price_paise: 1 },
    { name: "public_offer_product_price_v1" },
  );
  await db.collection("seller_offers").createIndex(
    { status: 1, sale_price_paise: 1, product_id: 1 },
    { name: "public_offer_price_product_v1" },
  );
  await db.collection("seller_offers").createIndex({ seller_id: 1, status: 1 });
  await db.collection("seller_offers").createIndex({ "age_bounds.applicable": 1, "age_bounds.minAge": 1, "age_bounds.maxAge": 1 });
  await db.collection("seller_offers").createIndex({ "fit_bounds.applicable": 1, "fit_bounds.minHeightCm": 1, "fit_bounds.maxHeightCm": 1, "fit_bounds.minWeightKg": 1, "fit_bounds.maxWeightKg": 1 });
  await db.collection("available_filter_cache").createIndex({ cache_key: 1 }, { unique: true });
  await db.collection("available_filter_cache").createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await db.collection("carts").createIndex({ user_id: 1 }, { unique: true });
  await db.collection("orders").createIndex({ order_number: 1 }, { unique: true });
  await db.collection("orders").createIndex({ user_id: 1, placed_at: -1 });
  await db.collection("user_appearance_runs").createIndex({ user_id: 1, input_hash: 1, contract_version: 1 }, { unique: true });
  await db.collection("user_appearance_runs").createIndex({ user_id: 1, created_at: -1 });
  await db.collection("audit_logs").createIndex({ entity_type: 1, entity_id: 1, created_at: -1 });
}

async function syncCatalogueProjection(db) {
  const products = db.collection("products");
  const offers = db.collection("seller_offers");
  const approvedSellerIds = await db.collection("sellers").distinct("_id", { status: "approved" });
  const eligibleOfferMatch = {
    status: "active",
    seller_id: { $in: approvedSellerIds },
    inventory: { $elemMatch: { active: true, availableQty: { $gt: 0 } } },
  };
  const eligibleProductIds = await offers.distinct("product_id", eligibleOfferMatch);
  const now = new Date();
  await offers.aggregate([
    { $match: eligibleOfferMatch },
    { $group: { _id: "$product_id", catalogue_min_price_paise: { $min: "$sale_price_paise" } } },
    { $set: { catalogue_eligible: true, catalogue_eligibility_updated_at: now } },
    {
      $merge: {
        into: "products",
        on: "_id",
        whenMatched: [{
          $set: {
            catalogue_eligible: "$$new.catalogue_eligible",
            catalogue_min_price_paise: "$$new.catalogue_min_price_paise",
            catalogue_eligibility_updated_at: "$$new.catalogue_eligibility_updated_at",
          },
        }],
        whenNotMatched: "discard",
      },
    },
  ], { allowDiskUse: true }).toArray();
  await products.updateMany(
    { _id: { $nin: eligibleProductIds } },
    {
      $set: { catalogue_eligible: false, catalogue_eligibility_updated_at: now },
      $unset: { catalogue_min_price_paise: "" },
    },
  );
  return eligibleProductIds.length;
}

function metadataFieldDocument(field) {
  return {
    key: field.key,
    label: field.label,
    description: field.description ?? null,
    group: field.group,
    data_type: field.dataType,
    storage: field.storage,
    storage_path: field.storagePath,
    control: field.control,
    options: (field.options ?? []).map((option) => typeof option === "object" ? option : { key: option, label: option.replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase()), active: true }),
    validation: field.validation ?? {},
    filterable: Boolean(field.filterable),
    searchable: Boolean(field.searchable),
    gemini_allowed: Boolean(field.geminiAllowed),
    frontend_visible: Boolean(field.frontendVisible),
    usage_frequency: field.usageFrequency ?? "long_tail",
    sort_order: Number(field.sortOrder ?? 0),
    schema_version: Number(field.schemaVersion ?? 1),
    status: field.status ?? "active",
    metadata: field.metadata ?? {},
  };
}

async function keyMap(collection, keyPath, query = {}) {
  const projection = { [keyPath]: 1 };
  const result = new Map();
  for await (const document of collection.find(query, { projection })) {
    const value = keyPath.split(".").reduce((current, part) => current?.[part], document);
    if (value) result.set(value, document._id);
  }
  return result;
}

async function main() {
  const validation = readJson(validationPath);
  if (!validation.valid) throw new Error("Processed data validation is not valid.");
  const entitySeedDirs = [...new Set([seedDir, ...supplementalSeedDirs])];
  let brands = mergeSeedRecords(entitySeedDirs.map((directory) => readJsonl(resolve(directory, "brands.jsonl"))));
  let sellers = mergeSeedRecords(entitySeedDirs.map((directory) => readJsonl(resolve(directory, "sellers.jsonl"))));
  let locations = mergeSeedRecords(entitySeedDirs.map((directory) => locationsFor(directory)));
  const colors = readJsonl(resolve(seedDir, "colors.jsonl"));
  const metadataFields = readJson(resolve(seedDir, "metadata_fields.json")).fields;
  const appConfigs = readJson(resolve(seedDir, "app_configs.json"));
  const localSearchModel = resolve(seedDir, "search_intent_model.json");
  const searchIntentModel = readJson(existsSync(localSearchModel) ? localSearchModel : resolve(sharedSeedDir, "search_intent_model.json"));
  const catalogueConfig = appConfigs.find((item) => item.key === "catalogue") ?? {};
  const importKey = requestedImportKey || catalogueConfig.metadata?.pipeline?.seed || `stylme-${validation.rows}-products`;
  const required = { brands: new Set(), sellers: new Set(), locations: new Set(), products: new Set() };
  let inputRows = 0;
  for await (const row of csvRows(inputPath)) {
    inputRows += 1;
    required.brands.add(row.brand_key);
    required.sellers.add(row.seller_key);
    required.locations.add(row.location_key);
    required.products.add(`${row.source}:${row.source_product_id}`);
  }
  if (inputRows !== Number(validation.rows)) {
    throw new Error(`Input CSV has ${inputRows} rows but validation requires ${validation.rows}.`);
  }
  brands = brands.filter((item) => required.brands.has(item.key));
  sellers = sellers
    .filter((item) => required.sellers.has(item.key))
    .map((item) => ({ ...item, brand_keys: (item.brand_keys ?? []).filter((key) => required.brands.has(key)) }));
  locations = locations.filter((item) => required.locations.has(item.key));
  for (const [name, keys, records] of [
    ["brands", required.brands, brands],
    ["sellers", required.sellers, sellers],
    ["seller locations", required.locations, locations],
  ]) {
    const found = new Set(records.map((item) => item.key));
    const missing = [...keys].filter((key) => !found.has(key));
    if (missing.length) throw new Error(`Seed manifests are missing ${name} key ${missing[0]}.`);
  }
  const shouldConnect = has("--apply") || has("--check-connection");
  const plan = {
    mode: has("--apply") ? "apply" : has("--check-connection") ? "connection-check" : "dry-run",
    products: validation.rows,
    offers: validation.rows,
    brands: brands.length,
    sellers: sellers.length,
    sellerUsers: sellers.length,
    sellerLocations: locations.length,
    resolvedLocations: locations.filter((item) => item.geocode_resolved).length,
    colors: colors.length,
    metadataFields: metadataFields.length,
    appConfigs: appConfigs.length,
    searchIntentModelNodes: Object.keys(searchIntentModel.nodes ?? {}).length,
    batchSize,
    writeConcurrency,
    pruneManagedCatalog,
    pruneOnly,
  };
  if (!shouldConnect) {
    console.log(JSON.stringify(plan, null, 2));
    console.log("Dry-run only. Re-run with --apply to perform idempotent MongoDB upserts.");
    return;
  }

  // Read only Mongo settings from the selected file. AI/image keys in the root
  // environment are intentionally never copied into this process environment.
  const fileEnv = readEnv(envPath);
  const mongo = firstConfigured(fileEnv, mongoUriKey === "MONGODB_URL" ? [mongoUriKey, "MONGODB_URI"] : [mongoUriKey]);
  const database = firstConfigured(fileEnv, ["MONGODB_DB_NAME", "DATABASE_NAME"]);
  const uri = mongo.value;
  const databaseName = database.value || "stylme";
  if (!uri) throw new Error(`${mongoUriKey} is required in ${envPath}.`);
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 60_000,
    connectTimeoutMS: 30_000,
    socketTimeoutMS: 120_000,
    maxPoolSize: writeConcurrency + 2,
    retryWrites: true,
  });
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
  } catch (error) {
    await client.close().catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    const tlsFailure = detail.includes("SSL") || detail.includes("TLS") || detail.includes("tlsv1 alert");
    console.error(JSON.stringify({
      status: "connection-failed",
      envFile: envPath,
      uriVariable: mongo.key,
      databaseVariable: database.key,
      phase: tlsFailure ? "tls-before-authentication" : "server-selection-or-authentication",
      action: tlsFailure
        ? "Verify this cluster is active and this machine's public IP is allowed in the matching Atlas project's Network Access list."
        : "Verify the Atlas cluster, database user, password escaping, and project Network Access list.",
      error: detail,
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  if (has("--check-connection")) {
    console.log(JSON.stringify({
      ...plan,
      status: "connected",
      envFile: envPath,
      uriVariable: mongo.key,
      databaseVariable: database.key,
      database: databaseName,
    }, null, 2));
    await client.close();
    return;
  }
  const db = client.db(databaseName);
  if (pruneOnly) {
    if (!pruneManagedCatalog) throw new Error("--prune-only requires --prune-managed-catalog");
    const result = await pruneObsoleteManagedCatalog(db, required.products);
    console.log(JSON.stringify({ ...plan, database: databaseName, status: "pruned", ...result }, null, 2));
    await client.close();
    return;
  }
  await ensureIndexes(db);

  await bulk(db.collection("metadata_fields"), metadataFields.map((field) => ({ updateOne: { filter: { key: field.key }, update: { $set: metadataFieldDocument(field) }, upsert: true } })));
  await bulk(db.collection("app_configs"), appConfigs.map((item) => ({ updateOne: { filter: { key: item.key }, update: { $set: item }, upsert: true } })));
  await db.collection("search_intent_models").replaceOne({ key: searchIntentModel.key }, searchIntentModel, { upsert: true });
  await bulk(db.collection("colors"), colors.map((item) => ({
    updateOne: {
      filter: { key: item.key },
      update: { $set: {
        key: item.key,
        name: item.name,
        normalized_name: normalize(item.name),
        hex: item.hex ?? null,
        primary_family_key: item.primaryFamilyKey,
        family_keys: item.familyKeys,
        aliases: item.aliases ?? [],
        status: "active",
        metadata: { pipeline: { source: item.source, confidence: item.confidence } },
      } },
      upsert: true,
    },
  })));
  await bulk(db.collection("brands"), brands.map((item) => ({
    updateOne: {
      filter: { "metadata.pipeline.key": item.key },
      update: { $set: {
        name: item.name,
        normalized_name: item.normalized_name,
        slug: item.slug,
        aliases: item.aliases,
        status: "active",
        simulation_mode: false,
        metadata: { pipeline: { key: item.key, sources: item.sources, dedupeMethods: item.dedupe_methods } },
      } },
      upsert: true,
    },
  })));
  const brandIds = await keyMap(db.collection("brands"), "metadata.pipeline.key");
  const colorIds = await keyMap(db.collection("colors"), "key");

  await bulk(db.collection("users"), sellers.map((seller) => {
    const email = `seller+${stableHex(seller.key)}@seed.stylme.invalid`;
    return {
      updateOne: {
        filter: { email },
        update: { $set: {
          email,
          full_name: seller.name,
          avatar_url: null,
          status: "active",
          roles: ["seller"],
          onboarding_completed: true,
          addresses: [],
          default_address_id: null,
          default_pincode: null,
          preferences: {},
          body_profile: { heightCm: null, weightKg: null, measurements: {}, consent: false, updatedAt: null },
          whatsapp_opt_in: false,
          metadata: { pipeline: { sellerKey: seller.key, simulationMode: true } },
        } },
        upsert: true,
      },
    };
  }));
  const userIds = await keyMap(db.collection("users"), "metadata.pipeline.sellerKey", { "metadata.pipeline.sellerKey": { $exists: true } });
  await bulk(db.collection("sellers"), sellers.map((item) => ({
    updateOne: {
      filter: { "metadata.pipeline.key": item.key },
      update: { $set: {
        user_id: userIds.get(item.key),
        display_name: item.name,
        normalized_name: item.normalized_name,
        slug: item.slug,
        legal_details: null,
        contact: {},
        status: "approved",
        rejection_reason: null,
        approved_by_user_id: null,
        approved_at: null,
        brand_ids: (item.brand_keys ?? []).map((key) => brandIds.get(key)).filter(Boolean),
        simulation_mode: true,
        source_ref: null,
        metadata: { pipeline: { key: item.key, sources: item.sources, dedupeMethods: item.dedupe_methods } },
      } },
      upsert: true,
    },
  })));
  const sellerIds = await keyMap(db.collection("sellers"), "metadata.pipeline.key");

  const pincodeMap = new Map();
  for (const item of locations) pincodeMap.set(item.pincode, item);
  await bulk(db.collection("pincode_geos"), [...pincodeMap.values()].map((item) => ({
    updateOne: {
      filter: { country_code: "IN", pincode: item.pincode },
      update: { $set: {
        country_code: "IN",
        pincode: item.pincode,
        place: item.place ?? {},
        geo_point: item.geo_point ?? null,
        resolved: Boolean(item.geocode_resolved),
        metadata: { pipeline: { source: "pgeocode", seeded: true } },
        refreshed_at: new Date(),
      } },
      upsert: true,
    },
  })));
  await bulk(db.collection("seller_locations"), locations.map((item) => {
    const document = { ...item, seller_id: sellerIds.get(item.seller_key) };
    delete document.key;
    delete document.seller_key;
    document.metadata = document.metadata ?? {};
    document.metadata.pipeline = { ...(document.metadata.pipeline ?? {}), key: item.key };
    return { updateOne: { filter: { "metadata.pipeline.key": item.key }, update: { $set: document }, upsert: true } };
  }));
  const locationIds = await keyMap(db.collection("seller_locations"), "metadata.pipeline.key");

  let operations = [];
  const inputProductKeys = new Set();
  const completedProductKeys = new Set();
  for await (const document of db.collection("products").find(
    { "system_metadata.pipeline.seed": importKey },
    { projection: { source: 1, source_product_id: 1 } },
  )) completedProductKeys.add(`${document.source}:${document.source_product_id}`);
  let productUpserts = completedProductKeys.size;
  let nextProductLog = (Math.floor(productUpserts / 5000) + 1) * 5000;
  let pendingWrites = [];
  if (productUpserts) console.error(`[seed] resuming after ${productUpserts} completed products`);
  const queueProductBatch = async (batch) => {
    pendingWrites.push(bulk(db.collection("products"), batch).then(() => {
      productUpserts += batch.length;
      if (productUpserts >= nextProductLog) {
        console.error(`[seed] products ${productUpserts}/${validation.rows}`);
        nextProductLog += 5000;
      }
    }));
    if (pendingWrites.length >= writeConcurrency) await Promise.all(pendingWrites.splice(0));
  };
  for await (const row of csvRows(inputPath)) {
    const inputKey = `${row.source}:${row.source_product_id}`;
    inputProductKeys.add(inputKey);
    if (completedProductKeys.has(inputKey)) continue;
    const palette = JSON.parse(row.color_palette_json).map((value) => {
      const colorKey = value.colorKey;
      const result = { ...value, color_id: colorIds.get(colorKey) };
      delete result.colorKey;
      result.families = result.familyKeys ?? result.families ?? [];
      result.primary_family_key = result.primaryFamilyKey ?? result.primary_family_key ?? null;
      delete result.familyKeys;
      delete result.primaryFamilyKey;
      return result;
    });
    const document = {
      source: row.source,
      source_product_id: row.source_product_id,
      source_url: row.source_url,
      brand_id: brandIds.get(row.brand_key),
      title: row.title,
      normalized_title: row.normalized_title,
      slug: row.slug,
      description: row.description,
      status: row.status,
      visibility: row.visibility,
      category_key: row.category_key,
      product_type_key: row.product_type_key,
      gender_keys: JSON.parse(row.gender_keys_json),
      metadata: JSON.parse(row.product_metadata_json),
      media: JSON.parse(row.media_json),
      cover_image_url: row.cover_image_url || null,
      color_palette: palette,
      rating: JSON.parse(row.rating_json),
      source_details: JSON.parse(row.source_details_json),
      search_text: row.search_text,
      simulation_mode: boolValue(row.product_simulation_mode),
      created_by_user_id: null,
      system_metadata: JSON.parse(row.product_system_metadata_json),
    };
    operations.push({ updateOne: { filter: { source: row.source, source_product_id: row.source_product_id }, update: { $set: document }, upsert: true } });
    if (operations.length >= batchSize) {
      await queueProductBatch(operations);
      operations = [];
    }
  }
  if (operations.length) await queueProductBatch(operations);
  await Promise.all(pendingWrites.splice(0));
  console.error(`[seed] products ${productUpserts}/${validation.rows}`);
  const productIds = new Map();
  for await (const document of db.collection("products").find({ source: { $in: ["myntra_detailed", "myntra_large"] } }, { projection: { source: 1, source_product_id: 1 } })) {
    productIds.set(`${document.source}:${document.source_product_id}`, document._id);
  }

  let prunedProducts = 0;
  let prunedOffers = 0;
  if (pruneManagedCatalog) {
    ({ prunedProducts, prunedOffers } = await pruneObsoleteManagedCatalog(db, inputProductKeys));
    console.error(`[seed] pruned obsolete managed products=${prunedProducts} offers=${prunedOffers}`);
  }

  operations = [];
  const completedOfferCodes = new Set(await db.collection("seller_offers").distinct(
    "offer_code", { "metadata.pipeline.importKey": importKey },
  ));
  let offerUpserts = completedOfferCodes.size;
  let nextOfferLog = (Math.floor(offerUpserts / 5000) + 1) * 5000;
  pendingWrites = [];
  if (offerUpserts) console.error(`[seed] resuming after ${offerUpserts} completed offers`);
  const queueOfferBatch = async (batch) => {
    pendingWrites.push(bulk(db.collection("seller_offers"), batch).then(() => {
      offerUpserts += batch.length;
      if (offerUpserts >= nextOfferLog) {
        console.error(`[seed] offers ${offerUpserts}/${validation.rows}`);
        nextOfferLog += 5000;
      }
    }));
    if (pendingWrites.length >= writeConcurrency) await Promise.all(pendingWrites.splice(0));
  };
  for await (const row of csvRows(inputPath)) {
    if (completedOfferCodes.has(row.offer_code)) continue;
    const variants = JSON.parse(row.variants_json).map((variant) => {
      const result = { ...variant, color_id: colorIds.get(variant.colorKey) };
      delete result.colorKey;
      return result;
    });
    const inventory = JSON.parse(row.inventory_json).map((item) => {
      const result = { ...item, location_id: locationIds.get(item.locationKey) };
      delete result.locationKey;
      return result;
    });
    const offerMetadata = JSON.parse(row.offer_metadata_json);
    const document = {
      product_id: productIds.get(`${row.source}:${row.source_product_id}`),
      seller_id: sellerIds.get(row.seller_key),
      brand_id: brandIds.get(row.brand_key),
      offer_code: row.offer_code,
      status: "active",
      currency: row.currency,
      mrp_paise: Number(row.mrp_paise),
      sale_price_paise: Number(row.sale_price_paise),
      discount_percent: Number(row.discount_percent),
      offer_details: JSON.parse(row.offer_details_json),
      variants,
      inventory,
      fit_bounds: JSON.parse(row.fit_bounds_json),
      age_bounds: JSON.parse(row.age_bounds_json),
      available_size_keys: JSON.parse(row.available_size_keys_json),
      available_color_ids: JSON.parse(row.available_color_keys_json).map((key) => colorIds.get(key)),
      available_color_family_keys: JSON.parse(row.available_color_family_keys_json),
      location_ids: [locationIds.get(row.location_key)],
      simulation_mode: boolValue(row.offer_simulation_mode),
      created_by_user_id: null,
      metadata: {
        ...offerMetadata,
        pipeline: {
          ...(offerMetadata.pipeline ?? {}),
          importKey,
        },
      },
    };
    operations.push({ updateOne: { filter: { offer_code: row.offer_code }, update: { $set: document }, upsert: true } });
    if (operations.length >= batchSize) {
      await queueOfferBatch(operations);
      operations = [];
    }
  }
  if (operations.length) await queueOfferBatch(operations);
  await Promise.all(pendingWrites.splice(0));
  console.error(`[seed] offers ${offerUpserts}/${validation.rows}`);
  const catalogueEligibleProducts = await syncCatalogueProjection(db);
  console.error(`[seed] catalogue projection eligible=${catalogueEligibleProducts}`);

  // Facet availability is derived from products/offers. Never serve entries
  // computed against the previous catalogue revision after a successful seed.
  const invalidatedFilterCacheEntries = (await db.collection("available_filter_cache").deleteMany({})).deletedCount;

  await db.collection("import_jobs").updateOne(
    { "metadata.pipeline.key": importKey },
    { $set: {
      filename: "myntra-product.csv + myntra202305041052.csv",
      source: "myntra_mixed",
      status: "completed",
      counts: { total: validation.rows, valid: validation.rows, imported: validation.rows, rejected: 0 },
      mapping: { schemaVersion: 1, processedFile: inputPath.split("/").at(-1) },
      simulation_seed: importKey,
      errors: [],
      started_by_user_id: null,
      metadata: { pipeline: { key: importKey, idempotent: true } },
      started_at: new Date(),
      completed_at: new Date(),
    } },
    { upsert: true },
  );
  await db.collection("audit_logs").updateOne(
    { "metadata.pipeline.key": `${importKey}-seeded` },
    { $set: {
      actor_user_id: null,
      actor_role: "system",
      action: "seed_catalogue",
      entity_type: "import_job",
      entity_id: importKey,
      changes: { products: validation.rows, offers: validation.rows },
      metadata: { pipeline: { key: `${importKey}-seeded`, idempotent: true } },
      created_at: new Date(),
    } },
    { upsert: true },
  );

  const counts = {};
  for (const name of ["metadata_fields", "search_intent_models", "colors", "brands", "users", "sellers", "seller_locations", "pincode_geos", "products", "seller_offers", "import_jobs"]) {
    counts[name] = await db.collection(name).countDocuments();
  }
  console.log(JSON.stringify({ ...plan, database: databaseName, status: "seeded", prunedProducts, prunedOffers, catalogueEligibleProducts, invalidatedFilterCacheEntries, counts }, null, 2));
  await client.close();
}

await main();
