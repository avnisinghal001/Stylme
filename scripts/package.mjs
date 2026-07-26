#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const date = new Date().toISOString().slice(0, 10);
const output = join(root, "dist", `stylme-share-${date}.zip`);
const checksumPath = `${output}.sha256`;
const topFiles = [
  ".env.example", ".gitignore", "DATA.md", "PLAN.md", "SETUP.md", "SYSTEM_DESIGN.md",
  "VOICE_AI.md", "schema.md", "package.json", "package-lock.json",
];
const topDirectories = ["frontend", "backend", "Go-Backend", "Livekit-Agent", "data", "scripts"];
const excludedDirectories = new Set([
  ".git", ".next", ".venv", ".vercel", ".pytest_cache", ".ruff_cache", ".models",
  ".agents", ".claude", "__pycache__", "node_modules", "coverage", "dist", "processed",
  "raw", "test-results", "tmp",
]);
const excludedFiles = new Set([".DS_Store", ".env", ".coverage"]);
const copied = [];

function forbiddenPath(path) {
  const parts = relative(root, path).split(sep);
  const name = basename(path);
  return parts.some((part) => excludedDirectories.has(part))
    || parts.some((part) => part.endsWith(".egg-info"))
    || excludedFiles.has(name)
    || (name.startsWith(".env.") && name !== ".env.example")
    || name.endsWith(".zip")
    || name.endsWith(".tsbuildinfo")
    || name.endsWith(".log");
}

async function copyTree(source, destination) {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error(`Refusing symlink: ${source}`);
  if (sourceStat.isDirectory()) {
    if (forbiddenPath(source)) return;
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await copyTree(join(source, entry.name), join(destination, entry.name));
    }
    return;
  }
  if (!sourceStat.isFile() || forbiddenPath(source)) return;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  copied.push(relative(root, source));
}

function zipDirectory(cwd, archive) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("zip", ["-q", "-r", archive, "stylme"], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`zip exited with ${code}`)));
  });
}

await mkdir(dirname(output), { recursive: true });
await rm(output, { force: true });
await rm(checksumPath, { force: true });
const temporary = await mkdtemp(join(tmpdir(), "stylme-share-"));
const stage = join(temporary, "stylme");
try {
  await mkdir(stage, { recursive: true });
  for (const name of topFiles) await copyTree(join(root, name), join(stage, name));
  for (const name of topDirectories) await copyTree(join(root, name), join(stage, name));
  copied.sort();
  const manifest = [
    "StylMe share package",
    `Created: ${new Date().toISOString()}`,
    `Files: ${copied.length}`,
    "",
    "Excluded: secrets, .env, raw/processed catalogues, dependencies, virtual environments, build/deployment caches, nested Git data, model downloads, logs, test artefacts.",
    "Start with SETUP.md.",
    "",
    ...copied,
    "",
  ].join("\n");
  await writeFile(join(stage, "PACKAGE_MANIFEST.txt"), manifest, "utf8");
  const stagedEnv = await readFile(join(stage, ".env.example"), "utf8");
  if (/^(?:MONGODB_URL|MIGRATE_DESTINATION_MONGO_URI|JWT_SECRET|OWNER_PASSWORD_HASH|CRON_SECRET|CHECKOUT_RECOVERY_ENCRYPTION_KEY|AI_INTERNAL_API_KEY|CREDENTIAL_ENCRYPTION_KEY|OPENAI_API_KEY|LIVEKIT_API_KEY|LIVEKIT_API_SECRET|DEEPGRAM_API_KEY|SARVAM_API_KEY|TWILIO_AUTH_TOKEN)=\S+/m.test(stagedEnv)) {
    throw new Error(".env.example contains populated values; refusing to package");
  }
  await zipDirectory(temporary, output);
  const result = await stat(output);
  const checksum = createHash("sha256").update(await readFile(output)).digest("hex");
  await writeFile(checksumPath, `${checksum}  ${basename(output)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ output, checksumPath, checksum, files: copied.length + 1, bytes: result.size }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
