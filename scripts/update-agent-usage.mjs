#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  agentUsageOverlayText,
  recordUsageSample,
  summarizeDailyUsage,
} from "../src/agent-usage-telemetry.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
const usagePath = path.join(projectDir, "runtime", "agent-usage.json");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const cumulativeTokens = Number(option("--cumulative-tokens"));
const model = option("--model", "ChatGPT 5.6 Sol");
const timeZone = option("--time-zone", "America/New_York");
const sampledAt = option("--sampled-at");
const sampledAtMs = sampledAt === undefined ? Date.now() : Date.parse(sampledAt);

let prior = {};
try {
  prior = JSON.parse(await fs.readFile(usagePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const state = recordUsageSample(prior, {
  cumulativeTokens,
  sampledAtMs,
  model,
});
await fs.mkdir(path.dirname(usagePath), { recursive: true });
await fs.writeFile(usagePath, `${JSON.stringify(state, null, 2)}\n`, {
  mode: 0o600,
});
const summary = summarizeDailyUsage(state, { nowMs: sampledAtMs, timeZone });
console.log(JSON.stringify({
  usage_path: path.relative(projectDir, usagePath),
  model: summary.model,
  tokens_per_hour: summary.tokens_per_hour,
  sample_count: summary.sample_count,
  overlay_text: agentUsageOverlayText(summary),
}, null, 2));
