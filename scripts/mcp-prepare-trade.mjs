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

const targetName = argument("--target");
const serverId = Number.parseInt(argument("--server-id", ""), 10);
const itemId = Number.parseInt(argument("--item-id", ""), 10);
const maximumDistance = Number(argument("--maximum-distance", "6"));

if (!targetName || targetName.length > 64) {
  throw new Error("--target requires one exact NPC name of at most 64 characters.");
}
if (!Number.isInteger(serverId) || serverId < 1) {
  throw new Error("--server-id requires the exact positive NPC server ID.");
}
if (!Number.isInteger(itemId) || itemId < 1 || itemId > 65535) {
  throw new Error("--item-id must be an integer from 1 through 65535.");
}
if (!Number.isFinite(maximumDistance) || maximumDistance < 1 || maximumDistance > 6) {
  throw new Error("--maximum-distance must be between 1 and 6 yalms.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-prepare-trade", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const [before, state] = await Promise.all([
    client.callTool({
      name: "ffxi_observe",
      arguments: { radius: maximumDistance, max_entities: 24, event_limit: 8 },
    }),
    client.callTool({
      name: "ffxi_character_state",
      arguments: {
        inventory_container: 0,
        max_items: 80,
        include_recasts: false,
      },
    }),
  ]);
  if (before.isError || state.isError) {
    throw new Error("Could not read target and inventory preconditions.");
  }

  const observed = valueOf(before);
  const exactTarget = observed.nearby_entities?.find(
    (entity) =>
      entity.server_id === serverId
      && entity.name === targetName
      && entity.distance <= maximumDistance,
  );
  if (!exactTarget) {
    throw new Error("The exact NPC is not active inside the requested distance.");
  }
  const item = valueOf(state).inventory?.items?.find(
    (entry) => entry.item_id === itemId,
  );
  if (!item) {
    throw new Error(`Inventory does not contain requested item ID ${itemId}.`);
  }

  let selectedTarget;
  let verification;
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    selectedTarget = await client.callTool({
      name: "ffxi_target_entity",
      arguments: {
        server_id: serverId,
        name: targetName,
        max_distance: maximumDistance,
      },
    });
    if (selectedTarget.isError) throw new Error("Could not select the exact NPC.");

    await new Promise((resolve) => setTimeout(resolve, 300));
    verification = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: maximumDistance, max_entities: 12, event_limit: 8 },
    });
    if (
      verification.isError
      || valueOf(verification).target?.server_id !== serverId
    ) {
      throw new Error("The client did not accept the exact NPC target.");
    }

  } finally {
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    target: exactTarget,
    requested_item: item,
    target_selection: valueOf(selectedTarget),
    verified_target: valueOf(verification).target,
    prepared: true,
    next_action: "Open the main menu, select Trade, then verify the selected item ID before confirming.",
  }, null, 2));
} finally {
  await client.close();
}
