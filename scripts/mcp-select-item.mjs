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

const itemId = Number.parseInt(argument("--item-id", ""), 10);
const maxSteps = Number.parseInt(argument("--max-steps", "30"), 10);
const allowNotInInventory = process.argv.includes("--allow-not-in-inventory");

if (!Number.isInteger(itemId) || itemId < 1 || itemId > 65535) {
  throw new Error("--item-id must be an integer from 1 through 65535.");
}
if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 80) {
  throw new Error("--max-steps must be an integer from 1 through 80.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-select-item", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
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
  if (response.isError) throw new Error("Could not read character menu state.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  const initial = await state();
  if (!initial.menu_open) {
    throw new Error("Item selection requires an open in-game menu.");
  }

  const inventoryMatch = initial.inventory?.items?.find(
    (item) => item.item_id === itemId,
  );
  if (!inventoryMatch && !allowNotInInventory) {
    throw new Error(`Inventory does not contain requested item ID ${itemId}.`);
  }
  if (!initial.selected_item?.active) {
    throw new Error(
      "The open menu is not exposing an active inventory-item selection.",
    );
  }

  const observations = [{
    step: 0,
    selected_item: initial.selected_item,
  }];
  let current = initial;
  let reason = "max_steps";

  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    for (let step = 0; step <= maxSteps; step += 1) {
      if (current.selected_item?.item_id === itemId) {
        reason = "selected";
        break;
      }
      if (step === maxSteps) break;

      const down = await client.callTool({
        name: "ffxi_menu_input",
        arguments: { action: "down" },
      });
      if (down.isError) throw new Error(`Menu step ${step + 1} failed.`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      current = await state();
      observations.push({
        step: step + 1,
        menu_open: current.menu_open,
        selected_item: current.selected_item,
      });
      if (!current.menu_open || !current.selected_item?.active) {
        reason = "item_menu_closed";
        break;
      }
    }
  } finally {
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    requested_item: {
      item_id: itemId,
      inventory_slot: inventoryMatch?.slot,
      name: inventoryMatch?.name || current.selected_item?.name,
      count: inventoryMatch?.count,
      verified_in_inventory: Boolean(inventoryMatch),
    },
    reason,
    selected: reason === "selected",
    final_selected_item: current.selected_item,
    menu_open: current.menu_open,
    observations,
  }, null, 2));

  if (reason !== "selected") process.exitCode = 1;
} finally {
  await client.close();
}
