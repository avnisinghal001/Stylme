#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const python = join(
  root,
  "backend",
  ".venv",
  isWindows ? "Scripts/python.exe" : "bin/python",
);

const child = spawn(python, ["-m", "app.database.init_db"], {
  cwd: join(root, "backend"),
  env: process.env,
  stdio: "inherit",
});

child.once("error", (error) => {
  process.stderr.write(`[db:init] failed to start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  if (code) process.exitCode = code;
  else process.stdout.write("[db:init] indexes and managed metadata are ready\n");
});
