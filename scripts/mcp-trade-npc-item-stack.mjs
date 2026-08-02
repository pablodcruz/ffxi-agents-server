#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const targetName = "Abelard";
const npcServerId = 17793039;
const itemId = 9082;
const quantity = 3;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-trade-npc-item-stack",
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
  if (response.isError) throw new Error("Could not read Inventory state.");
  return valueOf(response);
}

function itemCount(snapshot) {
  return (snapshot.inventory?.items || [])
    .filter((item) => Number(item.item_id) === itemId)
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
}

try {
  await client.connect(transport);
  const [beforeState, beforeObserve] = await Promise.all([
    state(),
    client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 6, max_entities: 12, event_limit: 12 },
    }),
  ]);
  if (beforeObserve.isError || beforeState.menu_open) {
    throw new Error("Exact NPC trade requires a nearby target and closed menus.");
  }
  const observed = valueOf(beforeObserve);
  const npc = observed.nearby_entities?.find((entity) => (
    Number(entity.server_id) === npcServerId
    && entity.name === targetName
    && Number(entity.distance) <= 6
  ));
  const item = beforeState.inventory?.items?.find((entry) => (
    Number(entry.item_id) === itemId && Number(entry.count) >= quantity
  ));
  if (!npc || !item) {
    throw new Error("The exact Abelard and Bee Pollen x3 preconditions are absent.");
  }

  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");
    const trade = await client.callTool({
      name: "ffxi_trade_npc_item_stack",
      arguments: {
        npc_server_id: npcServerId,
        npc_index: Number(npc.index),
        source_slot: Number(item.slot),
        item_id: itemId,
        quantity,
        confirmation: "TRADE EXACT PRIVATE SERVER NPC ITEM STACK",
      },
    });
    if (trade.isError) throw new Error("The guarded exact NPC trade was rejected.");

    let afterState;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      afterState = await state();
      if (afterState.menu_open || itemCount(afterState) === itemCount(beforeState) - quantity) {
        break;
      }
    }
    if (!afterState?.menu_open && itemCount(afterState) !== itemCount(beforeState) - quantity) {
      throw new Error("The exact NPC trade did not start a scene or consume the stack.");
    }
    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      queued: true,
      npc,
      item: { item_id: itemId, quantity, source_slot: Number(item.slot) },
      inventory_count_before: itemCount(beforeState),
      inventory_count_after: itemCount(afterState),
      menu_open: afterState.menu_open,
      bridge_result: valueOf(trade),
      verified: true,
    }, null, 2));
  } finally {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
  }
} finally {
  await client.close().catch(() => {});
}
