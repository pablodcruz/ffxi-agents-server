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
const expectedPrice = Number.parseInt(argument("--price", ""), 10);

if (!Number.isInteger(itemId) || itemId < 1 || itemId > 65535) {
  throw new Error("--item-id must be an integer from 1 through 65535.");
}
if (!Number.isInteger(expectedPrice) || expectedPrice < 1) {
  throw new Error("--price must be a positive integer.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-buy-vendor-item",
  version: "0.1.0",
});

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
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

function countItem(characterState) {
  return characterState.inventory?.items
    ?.filter((item) => Number(item.item_id) === itemId)
    .reduce((total, item) => total + Number(item.count || 0), 0) || 0;
}

function gil(characterState) {
  return Number(
    characterState.inventory?.items
      ?.find((item) => Number(item.item_id) === 65535)
      ?.count || 0,
  );
}

function menuName(characterState) {
  return String(characterState.menu_name || "").trim();
}

async function menu(action, settleMs = 800) {
  const response = await client.callTool({
    name: "ffxi_menu_input",
    arguments: { action },
  });
  if (response.isError) throw new Error(`Menu ${action} pulse failed.`);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return valueOf(response);
}

function requireSelected(characterState, expectedMenu) {
  if (
    !characterState.menu_open
    || menuName(characterState) !== expectedMenu
    || !characterState.selected_item?.active
    || Number(characterState.selected_item.item_id) !== itemId
  ) {
    throw new Error(
      `Expected exact item ID ${itemId} in ${expectedMenu}; purchase stopped.`,
    );
  }
}

try {
  await client.connect(transport);
  const before = await state();
  requireSelected(before, "menu    shop");

  const beforeCount = countItem(before);
  const beforeGil = gil(before);
  if (beforeGil < expectedPrice) {
    throw new Error(`The expected ${expectedPrice}-gil purchase is unaffordable.`);
  }

  const inputs = [];
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    inputs.push(await menu("confirm"));
    let decision = await state();

    // Some clients expose the quantity control long enough to observe it,
    // while others advance the default quantity of one before the next
    // bridge observation lands. Accept only those two exact verified states.
    if (menuName(decision) === "menu    itemctrl") {
      requireSelected(decision, "menu    itemctrl");
      // General shops initialize their bounded quantity control at one.
      // Do not send directional input here: confirm that exact default.
      inputs.push(await menu("confirm"));
      decision = await state();
    }
    requireSelected(decision, "menu    shopbuy");

    // The normal general-shop decision query defaults to Cancel.
    // Move exactly once to Buy before confirming.
    inputs.push(await menu("up"));
    inputs.push(await menu("confirm", 1200));

    let after = await state();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (
        countItem(after) === beforeCount + 1
        && gil(after) === beforeGil - expectedPrice
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      after = await state();
    }

    const afterCount = countItem(after);
    const afterGil = gil(after);
    if (afterCount !== beforeCount + 1) {
      throw new Error(
        `Exact item ${itemId} count did not increase by one; no retry was attempted.`,
      );
    }
    if (afterGil !== beforeGil - expectedPrice) {
      throw new Error(
        `Gil changed from ${beforeGil} to ${afterGil}, not by expected price ${expectedPrice}.`,
      );
    }

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      purchased: true,
      item: {
        item_id: itemId,
        name: before.selected_item.name,
        unit_price: expectedPrice,
        quantity: 1,
      },
      inventory_count_before: beforeCount,
      inventory_count_after: afterCount,
      gil_before: beforeGil,
      gil_after: afterGil,
      final_menu: {
        open: after.menu_open,
        name: after.menu_name,
        selected_item: after.selected_item,
      },
      menu_inputs: inputs,
    }, null, 2));
  } finally {
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
  }
} finally {
  await client.close();
}
