#!/usr/bin/env node
// Idempotently copies every collection, document, and user-created index from
// the configured source database to a destination without printing credentials.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BSON, MongoClient } from "mongodb";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const envPath = resolve(valueOf("--env-file", resolve(projectRoot, ".env")));
const reportPath = resolve(valueOf("--output", resolve(projectRoot, "data/processed/mongo-destination-migration.json")));
const batchSize = Math.max(50, Math.min(1000, Number(valueOf("--batch-size", "250")) || 250));
const concurrency = Math.max(1, Math.min(8, Number(valueOf("--write-concurrency", "4")) || 4));

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

function configured(fileEnv, key, fallbacks = []) {
  for (const candidate of [key, ...fallbacks]) {
    const value = String(process.env[candidate] ?? fileEnv[candidate] ?? "").trim();
    if (value) return { key: candidate, value };
  }
  return { key: null, value: "" };
}

function endpoint(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.hostname;
  } catch {
    return "configured-mongodb-host";
  }
}

function collectionOptions(options = {}) {
  const allowed = [
    "capped", "size", "max", "validator", "validationLevel", "validationAction",
    "timeseries", "expireAfterSeconds", "clusteredIndex", "changeStreamPreAndPostImages",
  ];
  return Object.fromEntries(allowed.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
}

function indexDefinition(index) {
  const optionKeys = [
    "name", "unique", "sparse", "expireAfterSeconds", "partialFilterExpression",
    "collation", "weights", "default_language", "language_override", "wildcardProjection", "hidden",
  ];
  const options = Object.fromEntries(optionKeys.filter((key) => index[key] !== undefined).map((key) => [key, index[key]]));
  let keys = index.key;
  if (index.weights) {
    keys = {
      ...Object.fromEntries(Object.entries(index.key).filter(([key]) => !["_fts", "_ftsx"].includes(key))),
      ...Object.fromEntries(Object.keys(index.weights).map((key) => [key, "text"])),
    };
  }
  return { keys, options };
}

async function fingerprint(collection) {
  const hash = createHash("sha256");
  let count = 0;
  for await (const document of collection.find({}).sort({ _id: 1 }).batchSize(250)) {
    hash.update(BSON.EJSON.stringify(document, { relaxed: false }));
    hash.update("\n");
    count += 1;
  }
  return { count, sha256: hash.digest("hex") };
}

async function copyCollection(sourceDb, destinationDb, info) {
  const name = info.name;
  const existing = new Set((await destinationDb.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  if (!existing.has(name)) await destinationDb.createCollection(name, collectionOptions(info.options));
  const source = sourceDb.collection(name);
  const destination = destinationDb.collection(name);
  let operations = [];
  let pending = [];
  let copied = 0;
  let nextLog = 5000;
  const queue = async (batch) => {
    pending.push(destination.bulkWrite(batch, { ordered: false }).then(() => {
      copied += batch.length;
      if (copied >= nextLog) {
        process.stderr.write(`[mongo-copy] ${name} ${copied}\n`);
        nextLog += 5000;
      }
    }));
    if (pending.length >= concurrency) await Promise.all(pending.splice(0));
  };
  for await (const document of source.find({}).batchSize(batchSize)) {
    operations.push({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } });
    if (operations.length >= batchSize) {
      await queue(operations);
      operations = [];
    }
  }
  if (operations.length) await queue(operations);
  await Promise.all(pending);

  const indexes = await source.listIndexes().toArray();
  for (const index of indexes.filter((value) => value.name !== "_id_")) {
    const { keys, options } = indexDefinition(index);
    await destination.createIndex(keys, options);
  }
  process.stderr.write(`[mongo-copy] ${name} complete (${copied})\n`);
  return copied;
}

async function verifyDatabases(sourceDb, destinationDb, collectionNames) {
  const collections = [];
  for (const name of collectionNames) {
    const source = await fingerprint(sourceDb.collection(name));
    const destination = await fingerprint(destinationDb.collection(name));
    const byName = (left, right) => String(left.options.name).localeCompare(String(right.options.name));
    const sourceIndexes = (await sourceDb.collection(name).listIndexes().toArray()).map(indexDefinition).sort(byName);
    const destinationIndexes = (await destinationDb.collection(name).listIndexes().toArray()).map(indexDefinition).sort(byName);
    const indexesMatch = BSON.EJSON.stringify(sourceIndexes, { relaxed: false })
      === BSON.EJSON.stringify(destinationIndexes, { relaxed: false });
    collections.push({ name, source, destination, documentsMatch: source.count === destination.count && source.sha256 === destination.sha256, indexesMatch });
    process.stderr.write(`[mongo-verify] ${name} ${source.count === destination.count && source.sha256 === destination.sha256 && indexesMatch ? "valid" : "mismatch"}\n`);
  }
  return collections;
}

const fileEnv = readEnv(envPath);
const sourceConnection = configured(fileEnv, valueOf("--source-uri-key", "MONGODB_URL"), ["MONGODB_URI"]);
const destinationConnection = configured(fileEnv, valueOf("--destination-uri-key", "MIGRATE_DESTINATION_MONGO_URI"));
const sourceDatabase = valueOf("--source-database", process.env.MONGODB_DB_NAME || fileEnv.MONGODB_DB_NAME || fileEnv.DATABASE_NAME || "StylMe");
const destinationDatabase = valueOf("--destination-database", process.env.MIGRATE_DESTINATION_DB_NAME || fileEnv.MIGRATE_DESTINATION_DB_NAME || sourceDatabase);
if (!sourceConnection.value) throw new Error(`Source URI variable is missing in ${envPath}`);
if (!destinationConnection.value) throw new Error(`Destination URI variable is missing in ${envPath}`);
if (endpoint(sourceConnection.value) === endpoint(destinationConnection.value) && sourceDatabase === destinationDatabase) throw new Error("Source and destination resolve to the same database");

const sourceClient = new MongoClient(sourceConnection.value, { serverSelectionTimeoutMS: 20_000, maxPoolSize: 12 });
const destinationClient = new MongoClient(destinationConnection.value, { serverSelectionTimeoutMS: 20_000, maxPoolSize: 12 });
try {
  await Promise.all([sourceClient.connect(), destinationClient.connect()]);
  const sourceDb = sourceClient.db(sourceDatabase);
  const destinationDb = destinationClient.db(destinationDatabase);
  const sourceCollections = (await sourceDb.listCollections({}, { nameOnly: false }).toArray())
    .filter((item) => !item.name.startsWith("system."))
    .sort((left, right) => left.name.localeCompare(right.name));
  const destinationBefore = (await destinationDb.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
  if (has("--apply")) {
    for (const info of sourceCollections) await copyCollection(sourceDb, destinationDb, info);
  }
  const verification = await verifyDatabases(sourceDb, destinationDb, sourceCollections.map((item) => item.name));
  const destinationAfter = (await destinationDb.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
  const extraDestinationCollections = destinationAfter.filter((name) => !sourceCollections.some((item) => item.name === name));
  const valid = verification.every((item) => item.documentsMatch && item.indexesMatch) && extraDestinationCollections.length === 0;
  const report = {
    valid,
    mode: has("--apply") ? "copy-and-verify" : "verify-only",
    source: { host: endpoint(sourceConnection.value), database: sourceDatabase, collections: sourceCollections.length },
    destination: { host: endpoint(destinationConnection.value), database: destinationDatabase, collectionsBefore: destinationBefore.length, collectionsAfter: destinationAfter.length },
    copiedAt: new Date().toISOString(),
    batchSize,
    writeConcurrency: concurrency,
    extraDestinationCollections,
    collections: verification,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ valid, mode: report.mode, source: report.source, destination: report.destination, report: reportPath }, null, 2));
  if (!valid) process.exitCode = 1;
} finally {
  await Promise.allSettled([sourceClient.close(), destinationClient.close()]);
}
