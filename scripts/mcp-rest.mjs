#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const minimumHpPercent = Number(argument("--minimum-hp-percent", "90"));
const timeoutSeconds = Number(argument("--timeout", "90"));

if (!Number.isFinite(minimumHpPercent) || minimumHpPercent < 40 || minimumHpPercent > 100) {
  throw new Error("--minimum-hp-percent must be a number from 40 through 100.");
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 180) {
  throw new Error("--timeout must be a number from 5 through 180.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-rest", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 20, max_entities: 12, event_limit: 10 },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  return valueOf(response);
}

async function command(text) {
  const response = await client.callTool({
    name: "ffxi_gameplay_command",
    arguments: { command: text },
  });
  if (response.isError) throw new Error(`Gameplay command failed: ${text}`);
}

let result;
let failure;

try {
  await client.connect(transport);
  await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });

  const before = await observe();
  const samples = [{
    at: before.observed_at,
    player_hp_percent: before.player?.hp_percent,
  }];
  let reason = "already_ready";

  if ((before.player?.hp_percent ?? 0) < minimumHpPercent) {
    reason = "timeout";
    await command("/heal");
    const deadline = Date.now() + (timeoutSeconds * 1000);
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const observation = await observe();
        samples.push({
          at: observation.observed_at,
          player_hp_percent: observation.player?.hp_percent,
        });
        if ((observation.player?.hp_percent ?? 0) >= minimumHpPercent) {
          reason = "recovered";
          break;
        }
        if (observation.login_status !== 2) {
          reason = "not_logged_in";
          break;
        }
      }
    } finally {
      await command("/heal").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  const after = await observe();
  result = {
    protocol: "mcp-stdio",
    minimum_hp_percent: minimumHpPercent,
    timeout_seconds: timeoutSeconds,
    reason,
    before: {
      hp_percent: before.player?.hp_percent,
      position: before.player?.position,
    },
    after: {
      hp_percent: after.player?.hp_percent,
      position: after.player?.position,
    },
    samples,
  };
} catch (error) {
  failure = error;
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}

if (result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.reason === "timeout" || result.reason === "not_logged_in") {
    process.exitCode = 1;
  }
}
if (failure) {
  throw failure;
}
