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
const allowOpenTradeMenu = process.argv.includes("--allow-open-trade-menu");

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
const client = new Client({ name: "ffxi-agent-lab-trade-item", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function characterState() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      inventory_container: 0,
      max_items: 80,
      include_recasts: false,
    },
  });
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  const [beforeState, beforeObserve] = await Promise.all([
    characterState(),
    client.callTool({
      name: "ffxi_observe",
      arguments: { radius: maximumDistance, max_entities: 24, event_limit: 12 },
    }),
  ]);
  if (beforeObserve.isError) {
    throw new Error("Could not read the nearby target precondition.");
  }
  const observedTradeMenus = new Set(["menu    handover", "menu    inventor"]);
  if (
    beforeState.menu_open
    && (!allowOpenTradeMenu || !observedTradeMenus.has(beforeState.menu_name))
  ) {
    throw new Error("Close all in-game menus before issuing a verified item handoff.");
  }

  const observed = valueOf(beforeObserve);
  const beforeEventId = Math.max(
    0,
    ...(observed.recent_events || []).map((event) => event.id),
  );
  const exactTarget = observed.nearby_entities?.find(
    (entity) =>
      entity.server_id === serverId
      && entity.name === targetName
      && entity.distance <= maximumDistance,
  );
  if (!exactTarget) {
    throw new Error("The exact NPC is not active inside the requested distance.");
  }

  const matchingItems = beforeState.inventory?.items?.filter(
    (entry) => entry.item_id === itemId,
  ) || [];
  const item = matchingItems[0];
  if (!item) {
    throw new Error(`Inventory does not contain requested item ID ${itemId}.`);
  }
  const initialCount = matchingItems.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  if (
    typeof item.name !== "string"
    || item.name.length < 1
    || item.name.length > 64
    || /["\r\n;|]/.test(item.name)
  ) {
    throw new Error("The canonical client item name is unsafe for a gameplay command.");
  }

  const command = `/item "${item.name}" <t>`;
  let targetSelection;
  let verifiedTarget;
  let queuedCommand;
  let afterState;
  let afterObserve;
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    const clearTarget = await client.callTool({
      name: "ffxi_clear_target",
      arguments: {},
    });
    if (clearTarget.isError || !valueOf(clearTarget).cleared) {
      throw new Error("Could not normalize the client target state.");
    }

    targetSelection = await client.callTool({
      name: "ffxi_target_entity",
      arguments: {
        server_id: serverId,
        name: targetName,
        max_distance: maximumDistance,
      },
    });
    if (targetSelection.isError) throw new Error("Could not select the exact NPC.");

    await new Promise((resolve) => setTimeout(resolve, 300));
    verifiedTarget = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: maximumDistance, max_entities: 12, event_limit: 12 },
    });
    if (
      verifiedTarget.isError
      || valueOf(verifiedTarget).target?.server_id !== serverId
    ) {
      throw new Error("The client did not accept the exact NPC target.");
    }

    queuedCommand = await client.callTool({
      name: "ffxi_gameplay_command",
      arguments: { command },
    });
    if (queuedCommand.isError) {
      throw new Error("The allowlisted item handoff command was rejected.");
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    [afterState, afterObserve] = await Promise.all([
      characterState(),
      client.callTool({
        name: "ffxi_observe",
        arguments: { radius: maximumDistance, max_entities: 12, event_limit: 24 },
      }),
    ]);
    if (afterObserve.isError) {
      throw new Error("Could not observe the handoff result.");
    }
  } finally {
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
  }

  const remainingCount = afterState.inventory?.items
    ?.filter((entry) => entry.item_id === itemId)
    .reduce((sum, entry) => sum + entry.count, 0) || 0;
  const consumedCount = initialCount - remainingCount;
  const succeeded = consumedCount > 0;
  const newGameplayEvents = (valueOf(afterObserve).recent_events || []).filter(
    (event) =>
      event.id > beforeEventId
      && event.mode !== -1
      && !event.message.includes("[Agent Activity]"),
  );
  const dialogueStarted =
    !succeeded
    && afterState.menu_open
    && newGameplayEvents.length > 0;
  const reason = succeeded
    ? "item_consumed"
    : dialogueStarted
      ? "dialogue_started"
      : "no_observed_progress";

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    target: exactTarget,
    requested_item: item,
    verified_target: valueOf(verifiedTarget).target,
    command: valueOf(queuedCommand),
    result: {
      succeeded,
      accepted: succeeded || dialogueStarted,
      reason,
      consumed_count: consumedCount,
      remaining_count: remainingCount,
      started_from_open_trade_menu: beforeState.menu_open,
      menu_open: afterState.menu_open,
      menu_name: afterState.menu_name,
      next_action: dialogueStarted
        ? "Advance the active dialogue with mcp:dialogue, then verify the inventory and reward."
        : undefined,
    },
    recent_events: valueOf(afterObserve).recent_events,
  }, null, 2));

  if (!succeeded && !dialogueStarted) process.exitCode = 1;
} finally {
  await client.close();
}
