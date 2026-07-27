#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCheckVerdict } from "../src/check-verdict.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const targetName = argument("--target");
const serverId = Number(argument("--server-id"));
const maximumDistance = Number(argument("--maximum-distance", "20"));

if (!targetName || targetName.length > 64) {
  throw new Error("--target requires one exact name of at most 64 characters.");
}
if (!Number.isInteger(serverId) || serverId <= 0) {
  throw new Error("--server-id requires the exact positive ID from observation.");
}
if (!Number.isFinite(maximumDistance) || maximumDistance < 1 || maximumDistance > 50) {
  throw new Error("--maximum-distance must be from 1 through 50.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-check-target", version: "0.1.0" });
let connected = false;

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: {
      radius: maximumDistance,
      max_entities: 64,
      event_limit: 50,
    },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  connected = true;
  const before = await observe();
  const baselineEventId = Math.max(
    0,
    ...before.recent_events.map((event) => Number(event.id) || 0),
  );
  const entity = before.nearby_entities.find((candidate) => (
    candidate.server_id === serverId
    && candidate.name === targetName
    && candidate.status === 0
    && candidate.hp_percent > 0
  ));
  if (!entity) {
    throw new Error("The exact live target is not inside the observation radius.");
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");
  const target = await client.callTool({
    name: "ffxi_target_entity",
    arguments: {
      server_id: serverId,
      name: targetName,
      max_distance: maximumDistance,
    },
  });
  if (target.isError) throw new Error("Could not target the exact entity.");
  const check = await client.callTool({
    name: "ffxi_gameplay_command",
    arguments: { command: "/check <t>" },
  });
  if (check.isError) throw new Error("Could not queue /check.");

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = await observe();
  const result = parseCheckVerdict(after.recent_events, {
    afterEventId: baselineEventId,
  });
  const emergencyStop = await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: {},
  });
  const finalControl = await client.callTool({
    name: "ffxi_control_status",
    arguments: {},
  });

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mode: "non-combat-check",
    target: entity,
    result,
    emergency_stop: valueOf(emergencyStop),
    final_control: valueOf(finalControl),
  }, null, 2));
  if (result.verdict === "unknown") process.exitCode = 1;
} finally {
  if (connected) {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
    await client.close();
  }
}
