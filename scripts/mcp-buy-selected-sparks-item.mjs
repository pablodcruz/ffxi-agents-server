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
const expectedCost = Number.parseInt(argument("--cost", ""), 10);

if (!Number.isInteger(itemId) || itemId < 1 || itemId > 65535) {
  throw new Error("--item-id must be an integer from 1 through 65535.");
}
if (!Number.isInteger(expectedCost) || expectedCost < 1) {
  throw new Error("--cost must be a positive integer.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-buy-selected-sparks-item",
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
    ?.filter((item) => item.item_id === itemId)
    .reduce((total, item) => total + Number(item.count || 0), 0) || 0;
}

async function menu(action, settleMs = 900) {
  const response = await client.callTool({
    name: "ffxi_menu_input",
    arguments: { action },
  });
  if (response.isError) throw new Error(`Menu ${action} pulse failed.`);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return valueOf(response);
}

async function stagedMenu(action, settleMs = 900) {
  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");
  try {
    return await menu(action, settleMs);
  } finally {
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

try {
  await client.connect(transport);
  const before = await state();
  const beforeCount = countItem(before);

  if (
    !before.menu_open
    || !before.selected_item?.active
    || before.selected_item.item_id !== itemId
  ) {
    throw new Error(
      `Purchase requires exact item ID ${itemId} to be selected in an open Sparks item list.`,
    );
  }

  const inputs = [];
  try {
    inputs.push(await stagedMenu("confirm", 1200));
    const confirmationPrompt = await state();
    if (
      !confirmationPrompt.menu_open
      || !confirmationPrompt.selected_item?.active
      || confirmationPrompt.selected_item.item_id !== itemId
    ) {
      throw new Error(
        "The exact selected item did not persist into the Sparks confirmation.",
      );
    }

    // The first confirmation is a text prompt. Confirm it before trying to
    // navigate the separate "Make the exchange?" query, which defaults to No.
    inputs.push(await stagedMenu("confirm", 1200));
    const decisionQuery = await state();
    if (
      !decisionQuery.menu_open
      || decisionQuery.selected_item?.active
    ) {
      throw new Error(
        "The Sparks confirmation did not advance to its default-No decision query.",
      );
    }

    inputs.push(await stagedMenu("up", 1200));
    inputs.push(await stagedMenu("confirm", 1800));

    let after = await state();
    for (let attempt = 0; attempt < 8 && countItem(after) <= beforeCount; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      after = await state();
    }

    const afterCount = countItem(after);
    if (afterCount !== beforeCount + 1) {
      throw new Error(
        `Exact item ${itemId} inventory count did not increase by one; no retry was attempted.`,
      );
    }

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      purchased: true,
      item: {
        item_id: itemId,
        name: before.selected_item.name,
        expected_cost: expectedCost,
      },
      inventory_count_before: beforeCount,
      inventory_count_after: afterCount,
      menu_inputs: inputs,
      final_menu: {
        open: after.menu_open,
        name: after.menu_name,
        selected_item: after.selected_item,
      },
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
