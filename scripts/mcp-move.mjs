#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const targetIndex = process.argv.indexOf("--target");
const maxStartIndex = process.argv.indexOf("--max-start-distance");
const stopDistanceIndex = process.argv.indexOf("--stop-distance");
const timeoutIndex = process.argv.indexOf("--timeout");
const targetName = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
const maxStartDistance = maxStartIndex >= 0
  ? Number(process.argv[maxStartIndex + 1])
  : 40;
const stopDistance = stopDistanceIndex >= 0
  ? Number(process.argv[stopDistanceIndex + 1])
  : 3;
const timeoutSeconds = timeoutIndex >= 0
  ? Number(process.argv[timeoutIndex + 1])
  : 10;

if (!targetName) {
  throw new Error("Waypoint movement requires --target with one exact entity name.");
}
if (!Number.isFinite(maxStartDistance) || maxStartDistance < 2 || maxStartDistance > 40) {
  throw new Error("--max-start-distance must be a number from 2 through 40.");
}
if (!Number.isFinite(stopDistance) || stopDistance < 1 || stopDistance > 10) {
  throw new Error("--stop-distance must be a number from 1 through 10.");
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 20) {
  throw new Error("--timeout must be a number from 1 through 20.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-move", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function summarizeObservation(response) {
  const value = valueOf(response);
  return {
    player: value.player,
    target: value.target,
    nearby_entities: value.nearby_entities,
    recent_events: value.recent_events,
  };
}

try {
  await client.connect(transport);
  const before = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 40, max_entities: 24, event_limit: 6 },
  });
  let target;
  let movement;
  let after;

  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) {
      throw new Error("Could not arm private-server control.");
    }

    target = await client.callTool({
      name: "ffxi_target_entity",
      arguments: { name: targetName, max_distance: maxStartDistance },
    });
    if (target.isError) {
      throw new Error(`Could not target ${targetName}.`);
    }

    movement = await client.callTool({
      name: "ffxi_move_to_entity",
      arguments: {
        server_id: valueOf(target).server_id,
        max_start_distance: maxStartDistance,
        stop_distance: stopDistance,
        timeout_seconds: timeoutSeconds,
        stuck_seconds: 2,
      },
    });
    await new Promise((resolve) => setTimeout(
      resolve,
      (timeoutSeconds * 1000) + 500,
    ));
    after = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 40, max_entities: 24, event_limit: 10 },
    });
  } finally {
    await client.callTool({ name: "ffxi_stop_movement", arguments: {} });
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} });
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    waypoint: targetName,
    before: summarizeObservation(before),
    target: valueOf(target),
    movement: valueOf(movement),
    after: summarizeObservation(after),
  }, null, 2));

  if (before.isError || target?.isError || movement?.isError || after?.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
