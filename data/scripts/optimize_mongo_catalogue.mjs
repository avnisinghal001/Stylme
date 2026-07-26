#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const projectRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
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

const envPath = resolve(valueOf("--env-file", resolve(projectRoot, ".env")));
const fileEnv = readEnv(envPath);
const mongoUriKey = valueOf("--mongo-uri-key", "MIGRATE_DESTINATION_MONGO_URI");
const uriKeys = [mongoUriKey];
if (mongoUriKey === "MIGRATE_DESTINATION_MONGO_URI") {
  uriKeys.push("MONGODB_URL", "MONGODB_URI");
}
const uri = firstConfigured(fileEnv, uriKeys);
const databaseName = firstConfigured(fileEnv, ["MONGODB_DB_NAME", "DATABASE_NAME"]) || "StylMe";
if (!uri) throw new Error(`${mongoUriKey} is not configured in ${envPath}`);

const indexPlan = {
  products: [
    {
      name: "catalogue_newest_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, created_at: -1, _id: -1 },
    },
    {
      name: "catalogue_relevance_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, "rating.count": -1, "rating.average": -1, _id: -1 },
    },
    {
      name: "catalogue_rating_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, "rating.average": -1, "rating.count": -1, _id: -1 },
    },
    {
      name: "catalogue_related_rating_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, category_key: 1, "rating.average": -1, "rating.count": -1, _id: -1 },
    },
    {
      name: "catalogue_price_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, catalogue_min_price_paise: 1, _id: -1 },
    },
    {
      name: "catalogue_category_type_newest_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, category_key: 1, product_type_key: 1, created_at: -1, _id: -1 },
    },
    {
      name: "catalogue_brand_newest_v1",
      key: { status: 1, visibility: 1, catalogue_eligible: 1, brand_id: 1, created_at: -1, _id: -1 },
    },
  ],
  seller_offers: [
    {
      name: "public_offer_product_price_v1",
      key: { product_id: 1, status: 1, sale_price_paise: 1 },
    },
    {
      name: "public_offer_price_product_v1",
      key: { status: 1, sale_price_paise: 1, product_id: 1 },
    },
  ],
  sellers: [
    {
      name: "admin_sellers_status_created_v1",
      key: { status: 1, created_at: -1, _id: -1 },
    },
  ],
  seller_locations: [
    {
      name: "seller_locations_options_v1",
      key: { seller_id: 1, status: 1, name: 1 },
    },
  ],
  brands: [{ name: "active_brands_name_v1", key: { status: 1, name: 1 } }],
  colors: [{ name: "active_colors_name_v1", key: { status: 1, name: 1 } }],
  app_configs: [{ name: "key_1", key: { key: 1 }, unique: true }],
  product_drafts: [
    {
      name: "admin_product_drafts_status_updated_v1",
      key: { status: 1, updated_at: -1 },
    },
  ],
  audit_logs: [
    { name: "audit_entity_created_v1", key: { entity_type: 1, created_at: -1 } },
    { name: "audit_created_v1", key: { created_at: -1 } },
  ],
};

async function explainSummary(cursor) {
  const result = await cursor.explain("executionStats");
  return {
    nReturned: result.executionStats?.nReturned ?? null,
    executionTimeMillis: result.executionStats?.executionTimeMillis ?? null,
    totalKeysExamined: result.executionStats?.totalKeysExamined ?? null,
    totalDocsExamined: result.executionStats?.totalDocsExamined ?? null,
  };
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  try {
    await client.connect();
    const database = client.db(databaseName);
    const products = database.collection("products");
    const offers = database.collection("seller_offers");
    const sellers = database.collection("sellers");
    const approvedSellerIds = await sellers.distinct("_id", { status: "approved" });
    const eligibleOfferMatch = {
      status: "active",
      seller_id: { $in: approvedSellerIds },
      inventory: { $elemMatch: { active: true, availableQty: { $gt: 0 } } },
    };
    const eligibleProductIds = await offers.distinct("product_id", eligibleOfferMatch);
    const before = {
      products: await products.estimatedDocumentCount(),
      activePublicProducts: await products.countDocuments({ status: "active", visibility: "public" }),
      projectedEligibleProducts: eligibleProductIds.length,
      currentlyEligibleProducts: await products.countDocuments({ catalogue_eligible: true }),
    };
    const existingByCollection = {};
    for (const collectionName of Object.keys(indexPlan)) {
      existingByCollection[collectionName] = new Set(
        (await database.collection(collectionName).indexes()).map((index) => index.name),
      );
    }
    const missingIndexes = Object.entries(indexPlan).flatMap(([collectionName, indexes]) =>
      indexes
        .filter((index) => !existingByCollection[collectionName].has(index.name))
        .map((index) => `${collectionName}.${index.name}`),
    );

    if (!apply) {
      console.log(JSON.stringify({
        status: "dry-run",
        target: { host: new URL(uri).hostname, database: databaseName, uriVariable: mongoUriKey },
        before,
        missingIndexes,
        next: "Run npm run db:optimize -- --apply to synchronize the read projection and create the indexes.",
      }, null, 2));
      return;
    }

    const projectionStartedAt = performance.now();
    const now = new Date();
    await offers.aggregate([
      { $match: eligibleOfferMatch },
      {
        $group: {
          _id: "$product_id",
          catalogue_min_price_paise: { $min: "$sale_price_paise" },
        },
      },
      {
        $set: {
          catalogue_eligible: true,
          catalogue_eligibility_updated_at: now,
        },
      },
      {
        $merge: {
          into: "products",
          on: "_id",
          whenMatched: [
            {
              $set: {
                catalogue_eligible: "$$new.catalogue_eligible",
                catalogue_min_price_paise: "$$new.catalogue_min_price_paise",
                catalogue_eligibility_updated_at: "$$new.catalogue_eligibility_updated_at",
              },
            },
          ],
          whenNotMatched: "discard",
        },
      },
    ], { allowDiskUse: true }).toArray();
    const ineligibleUpdate = await products.updateMany(
      {
        _id: { $nin: eligibleProductIds },
        $or: [
          { catalogue_eligible: { $ne: false } },
          { catalogue_min_price_paise: { $exists: true } },
        ],
      },
      {
        $set: {
          catalogue_eligible: false,
          catalogue_eligibility_updated_at: now,
        },
        $unset: { catalogue_min_price_paise: "" },
      },
    );
    const projectionDurationMs = Math.round(performance.now() - projectionStartedAt);

    const createdIndexes = [];
    const indexStartedAt = performance.now();
    for (const [collectionName, indexes] of Object.entries(indexPlan)) {
      for (const index of indexes) {
        const { key, ...options } = index;
        await database.collection(collectionName).createIndex(key, options);
        createdIndexes.push(`${collectionName}.${index.name}`);
      }
    }
    const indexDurationMs = Math.round(performance.now() - indexStartedAt);

    const sample = await products.findOne(
      { catalogue_eligible: true },
      { projection: { category_key: 1 } },
    );
    const base = { status: "active", visibility: "public", catalogue_eligible: true };
    const queryExplains = {
      newest: await explainSummary(
        products.find(base).sort({ created_at: -1, _id: -1 }).limit(24),
      ),
      relevance: await explainSummary(
        products.find(base).sort({ "rating.count": -1, "rating.average": -1, _id: -1 }).limit(24),
      ),
      related: sample
        ? await explainSummary(
            products
              .find({ ...base, category_key: sample.category_key })
              .sort({ "rating.average": -1, "rating.count": -1, _id: -1 })
              .limit(8),
          )
        : null,
    };
    const after = {
      eligibleProducts: await products.countDocuments({ catalogue_eligible: true }),
      ineligibleProducts: await products.countDocuments({ catalogue_eligible: false }),
      ineligibleModified: ineligibleUpdate.modifiedCount,
    };
    console.log(JSON.stringify({
      status: "applied",
      target: { host: new URL(uri).hostname, database: databaseName, uriVariable: mongoUriKey },
      before,
      after,
      timingsMs: { projection: projectionDurationMs, indexes: indexDurationMs },
      createdIndexes,
      queryExplains,
    }, null, 2));
  } finally {
    await client.close();
  }
}

await main();
