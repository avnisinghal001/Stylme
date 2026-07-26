#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const python = join(root, "backend", ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
const flags = new Set(process.argv.slice(2));

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

function validateEnvironment() {
  const path = join(root, ".env");
  const file = readEnv(path);
  const value = (key) => String(process.env[key] ?? file[key] ?? "").trim();
  const failures = [];
  if (!value("MIGRATE_DESTINATION_MONGO_URI") && !value("MONGODB_URL") && !value("MONGODB_URI")) failures.push("MONGODB_URL is required");
  if (value("JWT_SECRET").length < 32) failures.push("JWT_SECRET must contain at least 32 characters");
  if (value("AI_INTERNAL_API_KEY").length < 32) failures.push("AI_INTERNAL_API_KEY must contain at least 32 characters");
  if (Boolean(value("OWNER_EMAIL")) !== Boolean(value("OWNER_PASSWORD_HASH"))) failures.push("OWNER_EMAIL and OWNER_PASSWORD_HASH must be configured together");
  if (value("OWNER_PASSWORD_HASH") && !/^\$2[aby]\$/.test(value("OWNER_PASSWORD_HASH"))) failures.push("OWNER_PASSWORD_HASH must be a bcrypt hash, not plaintext");
  if (value("CRON_SECRET") && value("CRON_SECRET").length < 32) failures.push("CRON_SECRET must contain at least 32 characters");
  if (flags.has("--voice") || flags.has("--voice-only")) {
    for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) if (!value(key)) failures.push(`${key} is required for the voice worker`);
  }
  if (failures.length) throw new Error(`Environment preflight failed:\n- ${failures.join("\n- ")}\nSee SETUP.md and .env.example.`);
}

function goBin(name) {
  const explicit = spawnSync("go", ["env", "GOBIN"], { encoding: "utf8" }).stdout.trim();
  const base = explicit || join(spawnSync("go", ["env", "GOPATH"], { encoding: "utf8" }).stdout.trim(), "bin");
  return join(base, isWindows ? `${name}.exe` : name);
}

function pipe(name, stream, target) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line) target.write(`[${name}] ${line}\n`);
  });
}

try {
  validateEnvironment();
} catch (error) {
  process.stderr.write(`[dev] ${error.message}\n`);
  process.exit(1);
}

const regular = [
  { name: "go", command: goBin("air"), args: ["-c", ".air.toml"], cwd: join(root, "Go-Backend") },
  { name: "python", command: python, args: ["-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"], cwd: join(root, "backend") },
  { name: "frontend", command: npm, args: ["run", "dev"], cwd: join(root, "frontend") },
];
const voice = { name: "voice", command: "uv", args: ["run", "python", "src/agent.py", "dev"], cwd: join(root, "Livekit-Agent") };
const services = flags.has("--voice-only") ? [voice] : flags.has("--voice") ? [...regular, voice] : regular;
const children = [];
let stopping = false;

function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
  const timer = setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 5000);
  timer.unref();
  if (children.every((child) => child.exitCode !== null)) process.exit(exitCode);
}

for (const service of services) {
  const child = spawn(service.command, service.args, { cwd: service.cwd, env: process.env, stdio: ["inherit", "pipe", "pipe"] });
  children.push(child);
  pipe(service.name, child.stdout, process.stdout);
  pipe(service.name, child.stderr, process.stderr);
  child.once("error", (error) => {
    process.stderr.write(`[${service.name}] failed to start: ${error.message}\n`);
    stop("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      process.stderr.write(`[${service.name}] exited (${code ?? signal}); stopping the remaining services\n`);
      stop("SIGTERM", code || 1);
    }
  });
}

process.stdout.write(`[dev] started ${services.map((service) => service.name).join(", ")}\n`);
process.on("SIGINT", () => stop("SIGINT", 0));
process.on("SIGTERM", () => stop("SIGTERM", 0));
