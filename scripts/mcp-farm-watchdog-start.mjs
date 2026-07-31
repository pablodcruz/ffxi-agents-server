#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const projectDir = path.resolve(import.meta.dirname, "..");
const statePath = path.join(projectDir, "runtime", "farm-monitor", "primary.json");
const intervalSeconds = 15;

async function liveWatchdog() {
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    const fresh = Date.now() - Number(state.heartbeat_at_ms) < intervalSeconds * 3_000;
    if (!fresh || !Number.isInteger(Number(state.pid))) return null;
    process.kill(Number(state.pid), 0);
    return state;
  } catch {
    return null;
  }
}

const existing = await liveWatchdog();
if (existing) {
  console.log(JSON.stringify({
    status: "already_running",
    pid: existing.pid,
    heartbeat_at_ms: existing.heartbeat_at_ms,
    disposition: existing.disposition,
  }, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, [
  path.join(projectDir, "scripts", "mcp-farm-watchdog.mjs"),
  "--interval-seconds", String(intervalSeconds),
  "--stop-after-nm-kills", "0",
  "--confirmation", "ARM PRIVATE SERVER FARM WATCHDOG",
], {
  cwd: projectDir,
  detached: true,
  stdio: "ignore",
});
child.unref();

console.log(JSON.stringify({
  status: "started",
  pid: child.pid,
  interval_seconds: intervalSeconds,
  stop_after_nm_kills: 0,
}, null, 2));
