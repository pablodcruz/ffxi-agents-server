#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const targetItem = {
  id: 12385,
  name: "Acheron Shield",
  expectedGil: 27550,
};
const vendor = {
  id: 17739803,
  name: "Balthilda",
  zoneId: 235,
  maximumDistance: 6,
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-sell-sparks-item",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

function menuName(state) {
  return state.menu_name?.trim() || "";
}

function gil(state) {
  return state.inventory?.items
    ?.find((item) => item.item_id === 65535)?.count ?? 0;
}

function itemUnits(state) {
  return state.inventory?.items
    ?.filter((item) => item.item_id === targetItem.id)
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

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 10, max_entities: 12, event_limit: 12 },
  });
  if (response.isError) throw new Error("Could not verify the vendor.");
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

async function waitFor(predicate, attempts = 10) {
  let current;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    current = await state();
    if (predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return current;
}

async function selectExactItem(current) {
  for (const action of ["down", "up"]) {
    for (let step = 0; step < 40; step += 1) {
      if (current.selected_item?.item_id === targetItem.id) return current;
      await input(action);
      current = await state();
      if (!current.menu_open || menuName(current) !== "menu    shop") break;
    }
  }
  return current;
}

try {
  await client.connect(transport);
  const [initial, initialObservation] = await Promise.all([
    state(),
    observe(),
  ]);
  const playerZoneId = Number(
    initialObservation.party?.find((member) => Number(member?.slot) === 0)
      ?.zone_id,
  );
  const exactVendor = initialObservation.nearby_entities?.find((entity) => (
    Number(entity.server_id) === vendor.id
    && entity.name === vendor.name
    && Number(entity.distance) <= vendor.maximumDistance
  ));

  if (
    playerZoneId !== vendor.zoneId
    || !exactVendor
    || !initial.menu_open
    || menuName(initial) !== "menu    shop"
    || !initial.selected_item?.active
  ) {
    throw new Error(
      "Safe Sparks resale requires Balthilda within 6 yalms and her open sell-item list.",
    );
  }
  if (itemUnits(initial) !== 1) {
    throw new Error(
      `Expected exactly one ${targetItem.name} in inventory before resale.`,
    );
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  let current = await selectExactItem(initial);
  if (current.selected_item?.item_id !== targetItem.id) {
    throw new Error(`Could not select exact item ID ${targetItem.id}.`);
  }

  const initialGil = gil(current);
  await input("confirm");
  current = await waitFor((value) => menuName(value) === "menu    shopsell");
  if (menuName(current) !== "menu    shopsell") {
    throw new Error("The exact-item sell confirmation did not open.");
  }

  // FFXI deliberately defaults the price confirmation to Cancel.
  await input("up");
  await input("confirm", 600);
  current = await waitFor((value) => (
    menuName(value) === "menu    shop"
    && itemUnits(value) === 0
    && gil(value) > initialGil
  ));

  const finalGil = gil(current);
  const gilReceived = finalGil - initialGil;
  if (
    menuName(current) !== "menu    shop"
    || itemUnits(current) !== 0
    || gilReceived !== targetItem.expectedGil
  ) {
    throw new Error(
      `Exact-item resale verification failed: expected ${targetItem.expectedGil} gil, received ${gilReceived}.`,
    );
  }

  const overlay = await client.callTool({
    name: "ffxi_set_goal_overlay",
    arguments: {
      enabled: true,
      current_gil: finalGil,
      target_gil: 10000,
    },
  });
  if (overlay.isError) throw new Error("Could not update the gil-goal overlay.");

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    vendor: {
      ...vendor,
      observed_distance: exactVendor.distance,
    },
    item: targetItem,
    initial_gil: initialGil,
    final_gil: finalGil,
    gil_received: gilReceived,
    inventory_count: current.inventory?.count,
    goal_overlay: valueOf(overlay),
    verified: true,
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}
