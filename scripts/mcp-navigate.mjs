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

const x = Number(argument("--x"));
const y = Number(argument("--y"));
const stopDistance = Number(argument("--stop-distance", "1"));
const timeoutSeconds = Number(argument("--timeout", "15"));

if (!Number.isFinite(x) || !Number.isFinite(y)) {
  throw new Error("Navigation requires finite --x and --y world coordinates.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-navigate", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  const movement = await client.callTool({
    name: "ffxi_move_to_position",
    arguments: {
      x,
      y,
      max_start_distance: 100,
      stop_distance: stopDistance,
      timeout_seconds: timeoutSeconds,
      stuck_seconds: 3,
    },
  });
  const deadline = Date.now() + (timeoutSeconds * 1000) + 500;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const status = await client.callTool({
      name: "ffxi_control_status",
      arguments: {},
    });
    if (!valueOf(status).movement) break;
  }
  const observation = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 20, max_entities: 12, event_limit: 8 },
  });
  const emergencyStop = await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: {},
  });
  const finalStatus = await client.callTool({
    name: "ffxi_control_status",
    arguments: {},
  });
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    waypoint: { x, y },
    movement: valueOf(movement),
    observation: valueOf(observation),
    emergency_stop: valueOf(emergencyStop),
    final_control: valueOf(finalStatus),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close();
}
