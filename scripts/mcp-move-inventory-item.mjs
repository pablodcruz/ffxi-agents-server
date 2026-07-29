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

function integerArgument(name, minimum, maximum) {
  const value = Number.parseInt(argument(name, ""), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

const allowedContainers = new Set([0, 6, 7, 8, 9]);
const sourceContainer = integerArgument("--source", 0, 9);
const sourceSlot = integerArgument("--slot", 1, 80);
const destinationContainer = integerArgument("--destination", 0, 9);
const itemId = integerArgument("--item-id", 1, 65534);
const quantity = integerArgument("--quantity", 1, 999999);

if (
  !allowedContainers.has(sourceContainer)
  || !allowedContainers.has(destinationContainer)
) {
  throw new Error("--source and --destination must be 0, 6, 7, 8, or 9.");
}
if (sourceContainer === destinationContainer) {
  throw new Error("--source and --destination must be different.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-move-inventory-item",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function containerState(container) {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      inventory_container: container,
      max_items: 80,
      include_recasts: false,
    },
  });
  if (response.isError) {
    throw new Error(`Could not read container ${container}.`);
  }
  return valueOf(response);
}

function itemTotal(state) {
  return state.inventory?.items
    ?.filter((item) => Number(item.item_id) === itemId)
    .reduce((sum, item) => sum + Number(item.count || 0), 0) || 0;
}

try {
  await client.connect(transport);
  const [beforeSource, beforeDestination] = await Promise.all([
    containerState(sourceContainer),
    containerState(destinationContainer),
  ]);
  if (beforeSource.menu_open || beforeDestination.menu_open) {
    throw new Error("Exact item transfer requires all in-game menus to be closed.");
  }
  const exactSource = beforeSource.inventory?.items?.find(
    (item) => (
      Number(item.slot) === sourceSlot
      && Number(item.item_id) === itemId
      && Number(item.count) >= quantity
    ),
  );
  if (!exactSource) {
    throw new Error("The exact source slot, item ID, and quantity are unavailable.");
  }

  const sourceTotalBefore = itemTotal(beforeSource);
  const destinationTotalBefore = itemTotal(beforeDestination);
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    const move = await client.callTool({
      name: "ffxi_move_inventory_item",
      arguments: {
        source_container: sourceContainer,
        source_slot: sourceSlot,
        destination_container: destinationContainer,
        item_id: itemId,
        quantity,
        confirmation: "MOVE PRIVATE SERVER INVENTORY ITEM",
      },
    });
    if (move.isError) throw new Error("The guarded item transfer was rejected.");

    let afterSource;
    let afterDestination;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      [afterSource, afterDestination] = await Promise.all([
        containerState(sourceContainer),
        containerState(destinationContainer),
      ]);
      if (
        itemTotal(afterSource) === sourceTotalBefore - quantity
        && itemTotal(afterDestination) === destinationTotalBefore + quantity
      ) {
        break;
      }
    }

    const sourceTotalAfter = itemTotal(afterSource);
    const destinationTotalAfter = itemTotal(afterDestination);
    if (
      sourceTotalAfter !== sourceTotalBefore - quantity
      || destinationTotalAfter !== destinationTotalBefore + quantity
    ) {
      throw new Error(
        "The exact source decrease and destination increase were not observed; no retry was attempted.",
      );
    }

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      moved: true,
      item: {
        item_id: itemId,
        name: exactSource.name,
        quantity,
      },
      source: {
        container_id: sourceContainer,
        slot: sourceSlot,
        item_total_before: sourceTotalBefore,
        item_total_after: sourceTotalAfter,
      },
      destination: {
        container_id: destinationContainer,
        item_total_before: destinationTotalBefore,
        item_total_after: destinationTotalAfter,
      },
      bridge_result: valueOf(move),
    }, null, 2));
  } finally {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
  }
} finally {
  await client.close();
}
