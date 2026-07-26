#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const commands = [
  ["frontend", isWindows ? "npm.cmd" : "npm", ["run", "lint"], join(root, "frontend")],
  ["frontend-types", isWindows ? "npm.cmd" : "npm", ["exec", "tsc", "--", "--noEmit"], join(root, "frontend")],
  ["backend", join(root, "backend", ".venv", isWindows ? "Scripts/python.exe" : "bin/python"), ["-m", "pytest", "-q"], join(root, "backend")],
  ["go", "go", ["test", "./..."], join(root, "Go-Backend")],
  ["data", join(root, "data", ".venv", isWindows ? "Scripts/python.exe" : "bin/python"), ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"], join(root, "data")],
  ["voice", "uv", ["run", "pytest", "-q"], join(root, "Livekit-Agent")],
  ["voice-lint", "uv", ["run", "ruff", "check", "src", "tests"], join(root, "Livekit-Agent")],
];

function run([name, command, args, cwd]) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.once("error", (error) => resolvePromise({ name, error: error.message }));
    child.once("exit", (code) => resolvePromise({ name, code }));
  });
}

const results = await Promise.all(commands.map(run));
const failed = results.filter((result) => result.code !== 0 || result.error);
for (const result of results) process.stdout.write(`[test] ${result.name}: ${result.code === 0 ? "passed" : result.error ?? `failed (${result.code})`}\n`);
if (failed.length) process.exitCode = 1;
