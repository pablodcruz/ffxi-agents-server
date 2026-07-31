#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const sellableItems = new Map([
  [505, "Sheepskin"],
  [768, "Flint Stone"],
  [852, "Lizard Skin"],
  [881, "Crab Shell"],
  [856, "Rabbit Hide"],
  [882, "Sheep Tooth"],
  [924, "Fiend Blood"],
  [925, "Giant Stinger"],
  [936, "Rock Salt"],
  [847, "Bird Feather"],
  [926, "Lizard Tail"],
  [953, "Treant Bulb"],
  [573, "Vegetable Seeds"],
  [575, "Grain Seeds"],
  [4570, "Bird Egg"],
]);
const maxSales = 20;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-sell-loot",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

function menuName(state) {
  return state.menu_name?.trim() || "";
}

function gil(state) {
  return state.inventory?.items?.find((item) => item.item_id === 65535)?.count ?? 0;
}

function itemUnits(state, itemId) {
  return state.inventory?.items
    ?.filter((item) => item.item_id === itemId)
    .reduce((total, item) => total + item.count, 0) ?? 0;
}

function sellableUnits(state) {
  return state.inventory?.items
    ?.filter((item) => sellableItems.has(item.item_id))
    .reduce((total, item) => total + item.count, 0) ?? 0;
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
  if (response.isError) throw new Error("Could not read the vendor menu state.");
  return valueOf(response);
}

async function input(action, delay = 400) {
  const response = await client.callTool({
    name: "ffxi_menu_input",
    arguments: { action },
  });
  if (response.isError) throw new Error(`Menu input ${action} failed.`);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function waitFor(predicate, attempts = 8) {
  let current;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    current = await state();
    if (predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return current;
}

async function moveToAllowlistedItem(current) {
  for (const action of ["down", "up"]) {
    for (let step = 0; step < 40; step += 1) {
      if (sellableItems.has(current.selected_item?.item_id)) return current;
      await input(action);
      current = await state();
    }
  }
  return current;
}

try {
  await client.connect(transport);
  const initial = await state();
  if (
    !initial.menu_open
    || menuName(initial) !== "menu    shop"
    || !initial.selected_item?.active
  ) {
    throw new Error(
      "Safe loot selling requires an open vendor sell-item list.",
    );
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const sales = [];
  let current = initial;
  for (let saleNumber = 0; saleNumber < maxSales; saleNumber += 1) {
    if (sellableUnits(current) === 0) break;

    current = await moveToAllowlistedItem(current);

    const itemId = current.selected_item?.item_id;
    if (!sellableItems.has(itemId)) {
      throw new Error("Could not reach an allowlisted loot item.");
    }

    const beforeGil = gil(current);
    const beforeUnits = itemUnits(current, itemId);
    const selected = {
      item_id: itemId,
      name: sellableItems.get(itemId),
      slot: current.selected_item.slot,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await input("confirm");
      current = await waitFor((value) =>
        ["menu    itemctrl", "menu    shopsell"].includes(menuName(value))
      );
      if (menuName(current) === "menu    itemctrl") {
        // Auto-Sort means sellable loot normally arrives as a stack. Accept
        // FFXI's bounded default quantity, then verify the actual unit and gil
        // deltas below. The next loop handles any units left in the stack.
        await input("confirm");
        current = await waitFor((value) => menuName(value) === "menu    shopsell");
      }
      if (menuName(current) === "menu    shopsell") break;
      if (menuName(current) !== "menu    shop") {
        throw new Error(`Unexpected menu while selecting ${selected.name}.`);
      }
    }
    if (menuName(current) !== "menu    shopsell") {
      throw new Error(`Price confirmation did not open for ${selected.name}.`);
    }

    // FFXI deliberately defaults this confirmation to Cancel.
    await input("up");
    await input("confirm", 600);
    current = await waitFor((value) =>
      menuName(value) === "menu    shop"
      && itemUnits(value, itemId) < beforeUnits
      && gil(value) > beforeGil
    );

    const afterGil = gil(current);
    const afterUnits = itemUnits(current, itemId);
    if (
      menuName(current) !== "menu    shop"
      || afterUnits >= beforeUnits
      || afterGil <= beforeGil
    ) {
      throw new Error(`Sale verification failed for ${selected.name}.`);
    }

    sales.push({
      ...selected,
      units_sold: beforeUnits - afterUnits,
      gil_received: afterGil - beforeGil,
      gil_after: afterGil,
    });
  }

  if (sellableUnits(current) > 0) {
    throw new Error(`Stopped after the bounded limit of ${maxSales} sales.`);
  }

  const overlay = await client.callTool({
    name: "ffxi_set_goal_overlay",
    arguments: {
      enabled: true,
      current_gil: gil(current),
      target_gil: 10000,
    },
  });
  if (overlay.isError) throw new Error("Could not update the gil-goal overlay.");

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    allowlist: Object.fromEntries(sellableItems),
    protected_items: [
      "equipped armor",
      "White Belt",
      "Bastokan Ring",
      "Meat Jerky",
      "G. Sheep Meat",
      "Hare Meat",
      "Beastmen's Seal",
    ],
    initial_gil: gil(initial),
    final_gil: gil(current),
    gil_received: gil(current) - gil(initial),
    sales,
    inventory_count: current.inventory?.count,
    sellable_units_remaining: sellableUnits(current),
    goal_overlay: valueOf(overlay),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}
