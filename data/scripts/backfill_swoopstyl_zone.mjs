#!/usr/bin/env node
// Idempotently adds simulated offer inventory to an already configured
// SwoopStyl zone. Existing locations and inventory are never removed.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const projectRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
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
    if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, index).trim()] = value;
  }
  return values;
}

function configured(fileEnv, keys) {
  for (const key of keys) {
    const value = String(process.env[key] ?? fileEnv[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

const envPath = resolve(valueOf("--env-file", resolve(projectRoot, ".env")));
const fileEnv = readEnv(envPath);
const uri = configured(fileEnv, [
  "MIGRATE_DESTINATION_MONGO_URI",
  "MONGODB_URL",
  "MONGODB_URI",
]);
const databaseName = configured(fileEnv, ["MONGODB_DB_NAME", "DATABASE_NAME"]) || "StylMe";
const pincode = String(valueOf("--pincode", "560041"));
const radiusKm = Math.max(1, Math.min(250, Number(valueOf("--radius-km", "100")) || 100));
const offerLimit = Math.max(1, Math.min(50_000, Number(valueOf("--offer-limit", "10000")) || 10000));
const apply = has("--apply");

if (!uri) throw new Error("A destination MongoDB URI is required");
if (!/^[1-9][0-9]{5}$/.test(pincode)) throw new Error("--pincode must be a valid six-digit Indian pincode");

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });

async function main() {
  await client.connect();
  const db = client.db(databaseName);
  const pincodeGeo = await db.collection("pincode_geos").findOne(
    { country_code: "IN", pincode, resolved: true },
    { projection: { geo_point: 1 } },
  );
  if (!pincodeGeo?.geo_point) throw new Error(`No resolved SwoopStyl zone map entry exists for ${pincode}`);

  const locations = await db.collection("seller_locations").aggregate([
    {
      $geoNear: {
        near: pincodeGeo.geo_point,
        key: "geo_point",
        distanceField: "_distance_meters",
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: {
          status: "active",
          geocode_resolved: true,
          swoopstyl_enabled: true,
          handling_hours: { $lte: 24 },
        },
      },
    },
    {
      $match: {
        $expr: {
          $lt: [
            { $ifNull: ["$current_committed_load", 0] },
            { $ifNull: ["$daily_capacity", 0] },
          ],
        },
      },
    },
    { $sort: { _distance_meters: 1, _id: 1 } },
    { $limit: 2000 },
  ]).toArray();
  if (!locations.length) throw new Error(`No active SwoopStyl seller locations exist within ${radiusKm} km of ${pincode}`);

  const approvedSellerIds = await db.collection("sellers").distinct("_id", {
    _id: { $in: [...new Set(locations.map((item) => item.seller_id))] },
    status: "approved",
  });
  const approved = new Set(approvedSellerIds.map(String));
  const targetBySeller = new Map();
  for (const location of locations) {
    const sellerKey = String(location.seller_id);
    if (approved.has(sellerKey) && !targetBySeller.has(sellerKey)) {
      targetBySeller.set(sellerKey, location);
    }
  }

  const targetLocationIds = [...targetBySeller.values()].map((item) => item._id);
  const offers = db.collection("seller_offers");
  const eligibleInventoryQuery = {
    status: "active",
    seller_id: { $in: approvedSellerIds },
    inventory: {
      $elemMatch: {
        location_id: { $in: targetLocationIds },
        active: true,
        availableQty: { $gt: 0 },
      },
    },
  };
  const before = await offers.countDocuments(eligibleInventoryQuery);
  const cursor = offers.find(
    { status: "active", seller_id: { $in: approvedSellerIds } },
    { projection: { seller_id: 1, inventory: 1, location_ids: 1 } },
  ).sort({ _id: 1 }).limit(offerLimit);

  let offersScanned = 0;
  let offersNeedingBackfill = 0;
  let inventoryEntriesPlanned = 0;
  let offersModified = 0;
  const operations = [];
  const flush = async () => {
    if (!operations.length || !apply) return;
    const result = await offers.bulkWrite(operations.splice(0), { ordered: false });
    offersModified += result.modifiedCount;
  };

  for await (const offer of cursor) {
    offersScanned += 1;
    const target = targetBySeller.get(String(offer.seller_id));
    if (!target) continue;
    const inventory = offer.inventory ?? [];
    const alreadyAvailable = inventory.some(
      (item) => String(item.location_id) === String(target._id)
        && item.active === true
        && Number(item.availableQty ?? 0) > 0,
    );
    if (alreadyAvailable) continue;
    const sourceInventory = inventory.filter(
      (item) => item.active === true && Number(item.availableQty ?? 0) > 0,
    );
    if (!sourceInventory.length) continue;
    const clones = sourceInventory.map((item) => ({
      ...item,
      location_id: target._id,
      source: "swoopstyl-zone-backfill",
    }));
    offersNeedingBackfill += 1;
    inventoryEntriesPlanned += clones.length;
    operations.push({
      updateOne: {
        filter: {
          _id: offer._id,
          inventory: {
            $not: {
              $elemMatch: {
                location_id: target._id,
                active: true,
                availableQty: { $gt: 0 },
              },
            },
          },
        },
        update: {
          $push: { inventory: { $each: clones } },
          $addToSet: { location_ids: target._id },
          $set: {
            "metadata.swoopstylZoneBackfill": {
              pincode,
              radiusKm,
              source: "simulated-inventory-reconciliation",
              appliedAt: new Date(),
            },
          },
        },
      },
    });
    if (operations.length >= 250) await flush();
  }
  await flush();

  const after = apply ? await offers.countDocuments(eligibleInventoryQuery) : before;
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    pincode,
    radiusKm,
    eligibleLocations: locations.length,
    approvedSellers: targetBySeller.size,
    offersScanned,
    offersEligibleBefore: before,
    offersNeedingBackfill,
    inventoryEntriesPlanned,
    offersModified,
    offersEligibleAfter: after,
  }, null, 2));
}

try {
  await main();
} finally {
  await client.close();
}
