#!/usr/bin/env node
// Drops only the explicitly confirmed source database after independent copy
// and 80k destination verification reports have both passed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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
    if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) value = value.slice(1, -1);
    values[line.slice(0, index).trim()] = value;
  }
  return values;
}

function endpoint(uri) {
  try { return new URL(uri).hostname; } catch { return "configured-mongodb-host"; }
}

const envPath = resolve(valueOf("--env-file", resolve(projectRoot, ".env")));
const migrationPath = resolve(valueOf("--migration-report", resolve(projectRoot, "data/processed/mongo-destination-migration.json")));
const cataloguePath = resolve(valueOf("--catalogue-report", resolve(projectRoot, "data/processed/catalogue-80k/mongo_verification.json")));
const outputPath = resolve(valueOf("--output", resolve(projectRoot, "data/processed/source-deletion-report.json")));
const env = readEnv(envPath);
const sourceUri = process.env.MONGODB_URL || env.MONGODB_URL || env.MONGODB_URI;
const destinationUri = process.env.MIGRATE_DESTINATION_MONGO_URI || env.MIGRATE_DESTINATION_MONGO_URI;
const database = process.env.MONGODB_DB_NAME || env.MONGODB_DB_NAME || env.DATABASE_NAME || "StylMe";
const confirmation = valueOf("--confirm-database", "");
if (!has("--apply")) throw new Error("Source deletion requires --apply");
if (confirmation !== database) throw new Error(`Source deletion requires --confirm-database ${database}`);
if (!sourceUri || !destinationUri) throw new Error("Both source and destination MongoDB URIs are required");
const migration = JSON.parse(readFileSync(migrationPath, "utf8"));
const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
if (!migration.valid || migration.source?.host !== endpoint(sourceUri) || migration.destination?.host !== endpoint(destinationUri) || migration.source?.database !== database || migration.destination?.database !== database) {
  throw new Error("The full-database migration report is invalid or does not match the configured endpoints");
}
if (!catalogue.valid || catalogue.counts?.products !== 80_000 || catalogue.counts?.offers !== 80_000 || catalogue.database !== database) {
  throw new Error("The destination 80k catalogue report is invalid");
}

const source = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 20_000 });
const destination = new MongoClient(destinationUri, { serverSelectionTimeoutMS: 20_000 });
try {
  await Promise.all([source.connect(), destination.connect()]);
  const destinationDb = destination.db(database);
  const destinationProducts = await destinationDb.collection("products").countDocuments({ source: { $in: ["myntra_detailed", "myntra_large"] } });
  const destinationCollections = await destinationDb.listCollections({}, { nameOnly: true }).toArray();
  if (destinationProducts !== 80_000 || destinationCollections.length < migration.destination.collectionsAfter) {
    throw new Error("Destination changed after verification; refusing source deletion");
  }
  const sourceDb = source.db(database);
  const sourceCollectionsBefore = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
  const dropped = await sourceDb.dropDatabase();
  const sourceCollectionsAfter = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
  const valid = Boolean(dropped) && sourceCollectionsAfter.length === 0;
  const report = {
    valid,
    deletedAt: new Date().toISOString(),
    source: { host: endpoint(sourceUri), database, collectionsBefore: sourceCollectionsBefore.length, collectionsAfter: sourceCollectionsAfter.length },
    destination: { host: endpoint(destinationUri), database, managedProducts: destinationProducts, collections: destinationCollections.length },
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ valid, source: report.source, destination: report.destination, report: outputPath }, null, 2));
  if (!valid) process.exitCode = 1;
} finally {
  await Promise.allSettled([source.close(), destination.close()]);
}
