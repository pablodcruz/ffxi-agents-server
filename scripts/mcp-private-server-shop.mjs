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

const action = String(argument("--action", "status")).toLowerCase();
const itemId = Number.parseInt(argument("--item-id", "12385"), 10);
const quantity = Number.parseInt(argument("--quantity", "1"), 10);
const purchasableItems = new Set([
  14326, 14425, 14857, 15164, 15314, // Garish level-30 RDM set
  16536, 16545, // Iron Sword and level-30 Broadsword
  12385, // Acheron Shield
  17391, 17396, // Willow Fishing Rod and Little Worm
]);
const saleUnitGil = new Map([
  [90, 50], // Rusty Bucket
  [4401, 10], // Moat Carp
  [4426, 52], // Tricolored Carp
  [4427, 300], // Gold Carp
  [4472, 10], // Crayfish
  [12385, 27550], // Acheron Shield
  [13454, 19], // Copper Ring
  [14117, 10], // Rusty Leggings
  [14242, 15], // Rusty Subligar
]);
const stackableSaleItems = new Set([4401, 4426, 4427, 4472]);
const allowedItems = new Set([...purchasableItems, ...saleUnitGil.keys(), 8711]);
if (!["status", "buy", "sell", "voucher"].includes(action)) {
  throw new Error("--action must be status, buy, sell, or voucher.");
}
if (!allowedItems.has(itemId)) {
  throw new Error("The requested item is outside the private-shop allowlist.");
}
const maximumQuantity = itemId === 17396 ? 99 : stackableSaleItems.has(itemId) ? 12 : 4;
if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximumQuantity) {
  throw new Error("--quantity is outside the exact item's transaction limit.");
}
if (action === "sell" && !stackableSaleItems.has(itemId) && quantity !== 1) {
  throw new Error("Non-stackable resale requires --quantity 1.");
}
if (action === "voucher" && (itemId !== 8711 || quantity !== 1)) {
  throw new Error("Voucher exchange requires --item-id 8711 and --quantity 1.");
}
if (action === "buy" && !purchasableItems.has(itemId)) {
  throw new Error("Purchase requires an allowlisted Sparks item.");
}
if (action === "sell" && !saleUnitGil.has(itemId)) {
  throw new Error("Resale requires an allowlisted item with a verified normal NPC value.");
}

const expectedUnitGil = saleUnitGil.get(itemId) || 0;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-private-shop", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function eventsOf(response) {
  const value = valueOf(response);
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

function countItem(state) {
  return state.inventory?.items
    ?.filter((item) => item.item_id === itemId)
    .reduce((sum, item) => sum + Number(item.count || 0), 0) || 0;
}

function gil(state) {
  return state.inventory?.items
    ?.find((item) => item.item_id === 65535)?.count || 0;
}

async function characterState() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: { inventory_container: 0, max_items: 80, include_recasts: false },
  });
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  const before = await characterState();
  const eventsBefore = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 100 },
  });
  if (eventsBefore.isError) throw new Error("Could not establish shop-event baseline.");
  const baselineEventId = eventsOf(eventsBefore).reduce(
    (maximum, event) => Math.max(maximum, Number(event?.id) || 0),
    0,
  );

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const command = await client.callTool({
    name: "ffxi_private_server_vendor_transaction",
    arguments: {
      action,
      item_id: itemId,
      quantity,
      confirmation: "TRANSACT WITH NEARBY PRIVATE SERVER VENDOR",
    },
  });
  if (command.isError) {
    const detail = command.content?.map((entry) => entry.text).filter(Boolean).join(" ");
    throw new Error(`Private-shop command was rejected${detail ? `: ${detail}` : "."}`);
  }

  let messages = [];
  let after = before;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const events = await client.callTool({ name: "ffxi_recent_events", arguments: { limit: 100 } });
    if (events.isError) throw new Error("Could not verify private-shop response.");
    messages = eventsOf(events).filter((event) => (
      (Number(event?.id) || 0) > baselineEventId
      && String(event?.message || "").includes("[AgentShop]")
    ));
    if (messages.length > 0) {
      after = await characterState();
      if (messages.some((event) => String(event.message).includes("[AgentShop] status"))) break;
    }
  }

  const rejected = messages.some((event) => String(event.message).includes("[AgentShop] rejected"));
  const beforeCount = countItem(before);
  const afterCount = countItem(after);
  const beforeGil = gil(before);
  const afterGil = gil(after);
  const purchased = messages.some((event) =>
    String(event.message).includes(`[AgentShop] purchased item=${itemId} quantity=${quantity}`));
  const sold = messages.some((event) =>
    String(event.message).includes(`[AgentShop] sold item=${itemId} quantity=${quantity}`));
  const exchanged = messages.some((event) =>
    String(event.message).includes(`[AgentShop] exchanged item=${itemId} quantity=1 sparks=1000`));

  if (messages.length === 0 || rejected) {
    throw new Error("Server rejected the private-shop transaction; inspect shop_messages.");
  }
  if (action === "buy" && (!purchased || afterCount !== beforeCount + quantity)) {
    throw new Error("Private-shop purchase was not verified by both server response and inventory.");
  }
  if (
    action === "sell"
    && (!sold || afterCount !== beforeCount - quantity || afterGil !== beforeGil + expectedUnitGil * quantity)
  ) {
    throw new Error("Item sale was not verified by server response, inventory, and exact normal NPC gil.");
  }
  if (action === "voucher" && !exchanged) {
    throw new Error("Copper Voucher exchange was not verified by the server response.");
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    action,
    item_id: itemId,
    quantity,
    command: valueOf(command),
    shop_messages: messages,
    before: { item_count: beforeCount, gil: beforeGil, inventory_count: before.inventory?.count },
    after: { item_count: afterCount, gil: afterGil, inventory_count: after.inventory?.count },
    verified: true,
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close().catch(() => {});
}
