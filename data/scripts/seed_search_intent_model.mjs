#!/usr/bin/env node
// Atomically publish only the trained intent graph. This deliberately reads
// Mongo settings from the root .env and never loads AI/image provider keys.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const projectRoot = resolve(import.meta.dirname, "../..");
const modelPath = resolve(projectRoot, "data/processed/seed/search_intent_model.json");
const envPath = resolve(projectRoot, ".env");

function readEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const fileEnv = readEnv(envPath);
const uri = process.env.MONGODB_URL || process.env.MONGODB_URI || fileEnv.MONGODB_URL || fileEnv.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME || process.env.DATABASE_NAME || fileEnv.MONGODB_DB_NAME || fileEnv.DATABASE_NAME || "stylme";
if (!uri) throw new Error(`MONGODB_URL (or MONGODB_URI) is required in ${envPath}.`);
const model = JSON.parse(readFileSync(modelPath, "utf8"));
if (!model.key || !model.nodes || model.training_rows !== 30000) throw new Error("Intent model is incomplete; rebuild it before seeding.");

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
try {
  await client.connect();
  const collection = client.db(databaseName).collection("search_intent_models");
  await collection.createIndex({ key: 1 }, { unique: true });
  await collection.replaceOne({ key: model.key }, model, { upsert: true });
  console.log(JSON.stringify({ status: "seeded", database: databaseName, key: model.key, version: model.version, trainingRows: model.training_rows, nodes: Object.keys(model.nodes).length }, null, 2));
} finally {
  await client.close();
}
