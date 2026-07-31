#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-close-current-target",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 15, max_entities: 12, event_limit: 10 },
  });
  if (response.isError) throw new Error("Could not observe FFXI.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  const before = await observe();
  const target = before.target;
  const distance = Number(target?.distance);
  if (
    before.login_status !== 2
    || Number(before.player?.status) !== 1
    || Number(target?.status) !== 1
    || !Number.isFinite(distance)
    || distance <= 2.5
    || distance > 10
  ) {
    throw new Error(
      "Current target is not a live engaged target requiring range correction.",
    );
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not enable private-server control.");

  const movement = await client.callTool({
    name: "ffxi_move_to_entity",
    arguments: {
      server_id: Number(target.server_id),
      name: target.name,
      max_start_distance: 10,
      stop_distance: 1.1,
      timeout_seconds: 3,
      stuck_seconds: 1,
    },
  });
  if (movement.isError) throw new Error("Could not correct engaged target range.");
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} });
  const after = await observe();
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    before: {
      player: before.player,
      target: before.target,
    },
    movement: valueOf(movement),
    after: {
      player: after.player,
      target: after.target,
    },
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}
