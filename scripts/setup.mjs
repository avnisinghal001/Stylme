#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const python = process.env.PYTHON || (isWindows ? "python" : "python3");
const venvPython = (directory) => join(root, directory, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
const playwright = join(root, "frontend", "node_modules", ".bin", isWindows ? "playwright.cmd" : "playwright");

function prefixed(name, stream) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line) process.stdout.write(`[${name}] ${line}\n`);
  });
  stream.on("end", () => {
    if (pending) process.stdout.write(`[${name}] ${pending}\n`);
  });
}

function run(name, command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    prefixed(name, child.stdout);
    prefixed(name, child.stderr);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function task(name, steps) {
  process.stdout.write(`[${name}] starting\n`);
  for (const [command, args, cwd] of steps) await run(name, command, args, cwd);
  process.stdout.write(`[${name}] ready\n`);
}

const backendPython = venvPython("backend");
const dataPython = venvPython("data");
const tasks = [
  task("frontend", [
    [npm, ["install"], join(root, "frontend")],
    [playwright, ["install", "chromium"], join(root, "frontend")],
  ]),
  task("backend", [
    ...(!existsSync(backendPython) ? [[python, ["-m", "venv", ".venv"], join(root, "backend")]] : []),
    [backendPython, ["-m", "pip", "install", "--upgrade", "pip"], join(root, "backend")],
    [backendPython, ["-m", "pip", "install", "-r", "requirements-dev.txt"], join(root, "backend")],
  ]),
  task("data", [
    [npm, ["install"], join(root, "data")],
    ...(!existsSync(dataPython) ? [[python, ["-m", "venv", ".venv"], join(root, "data")]] : []),
    [dataPython, ["-m", "pip", "install", "--upgrade", "pip"], join(root, "data")],
    [dataPython, ["-m", "pip", "install", "-r", "requirements.txt"], join(root, "data")],
  ]),
  task("go", [
    ["go", ["mod", "download"], join(root, "Go-Backend")],
    ["go", ["install", "github.com/air-verse/air@latest"], join(root, "Go-Backend")],
  ]),
  task("voice", [
    ["uv", ["sync", "--dev"], join(root, "Livekit-Agent")],
    ...(process.env.SETUP_SKIP_VOICE_MODELS === "1"
      ? []
      : [["uv", ["run", "-m", "livekit.agents", "download-files"], join(root, "Livekit-Agent")]]),
  ]),
];

const results = await Promise.allSettled(tasks);
const failures = results.filter((result) => result.status === "rejected");
if (failures.length) {
  for (const failure of failures) process.stderr.write(`[setup] ${failure.reason?.message ?? failure.reason}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("[setup] all workspaces are installed; copy .env.example to .env before npm run dev\n");
}
