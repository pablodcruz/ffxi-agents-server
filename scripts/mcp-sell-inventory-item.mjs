#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function integerArgument(name, minimum, maximum) {
  const value = Number.parseInt(argument(name), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

const allowedItems = new Set([
  90, 574, 894, 2016, 4360, 4385, 4401, 4426, 4427, 4443, 4472,
  4508, 4514, 13454, 14117, 14242,
  505, 573, 575, 768, 847, 852, 856, 881, 882, 924, 925, 926, 936, 953,
  4570, 12385,
  508, 511, 642, 750, 846, 912, 922, 1984, 4358, 4362, 4366, 4368,
  4370, 4372, 4387, 4400, 4468, 5187, 12464, 12592, 12631, 12720,
  12754, 12848, 12864, 12883, 12976, 13005, 17051, 17296, 17868,
]);
const sourceSlot = integerArgument("--slot", 1, 80);
const itemId = integerArgument("--item-id", 1, 65534);
const quantity = integerArgument("--quantity", 1, 99);
if (!allowedItems.has(itemId)) {
  throw new Error("--item-id is outside the repository-controlled NPC-sale allowlist.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-sell-inventory-item",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

function errorDetail(response) {
  if (Array.isArray(response?.content)) {
    return response.content
      .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
      .map((entry) => entry.text)
      .join(" ");
  }
  return "";
}

async function state() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      inventory_container: 0,
      max_items: 80,
      include_recasts: false,
    },
  });
  if (response.isError) throw new Error("Could not read live inventory state.");
  return valueOf(response);
}

function gil(snapshot) {
  return snapshot.inventory?.items
    ?.find((item) => Number(item.item_id) === 65535)?.count ?? 0;
}

function itemUnits(snapshot) {
  return snapshot.inventory?.items
    ?.filter((item) => Number(item.item_id) === itemId)
    .reduce((sum, item) => sum + Number(item.count || 0), 0) ?? 0;
}

try {
  await client.connect(transport);
  const before = await state();
  const exactItem = before.inventory?.items?.find((item) => (
    Number(item.slot) === sourceSlot
    && Number(item.item_id) === itemId
    && Number(item.count) >= quantity
  ));
  if (!exactItem) {
    throw new Error("The exact source slot, item ID, and quantity are unavailable.");
  }

  const beforeGil = gil(before);
  const beforeUnits = itemUnits(before);
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    const sale = await client.callTool({
      name: "ffxi_sell_inventory_item",
      arguments: {
        source_slot: sourceSlot,
        item_id: itemId,
        quantity,
        confirmation: "SELL PRIVATE SERVER INVENTORY ITEM",
      },
    });
    if (sale.isError) {
      const detail = errorDetail(sale);
      throw new Error(
        `The guarded exact NPC sale was rejected${detail ? `: ${detail}` : "."}`,
      );
    }

    let after;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      after = await state();
      if (
        itemUnits(after) === beforeUnits - quantity
        && gil(after) > beforeGil
      ) {
        break;
      }
    }
    const afterGil = gil(after);
    const afterUnits = itemUnits(after);
    if (
      afterUnits !== beforeUnits - quantity
      || afterGil <= beforeGil
    ) {
      throw new Error(
        "The exact inventory decrease and positive gil increase were not observed; no retry was attempted.",
      );
    }

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      sold: true,
      item: {
        item_id: itemId,
        name: exactItem.name,
        source_slot: sourceSlot,
        quantity,
      },
      inventory_units_before: beforeUnits,
      inventory_units_after: afterUnits,
      gil_before: beforeGil,
      gil_after: afterGil,
      gil_received: afterGil - beforeGil,
      bridge_result: valueOf(sale),
      verified: true,
    }, null, 2));
  } finally {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
  }
} finally {
  await client.close().catch(() => {});
}
