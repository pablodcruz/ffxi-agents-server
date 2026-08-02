#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-maat-genkai-trade", version: "0.1.0" });
const valueOf = (response) => response.structuredContent || response.content;

try {
  await client.connect(transport);
  const before = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 6, max_entities: 16, event_limit: 12 },
  });
  const state = await client.callTool({
    name: "ffxi_character_state",
    arguments: { inventory_container: 0, max_items: 80, include_recasts: false },
  });
  if (before.isError || state.isError) throw new Error("Could not verify Maat trade preconditions.");
  const observed = valueOf(before);
  const maat = observed.nearby_entities?.find(
    (entity) => entity.server_id === 17772593 && entity.name === "Maat" && entity.distance <= 6,
  );
  if (!maat) throw new Error("Exact Maat is not active within six yalms.");
  const inventory = valueOf(state).inventory?.items || [];
  const slotFor = (itemId) => inventory.find((item) => item.item_id === itemId && item.count === 1)?.slot;
  const slots = { mold_slot: slotFor(1089), coal_slot: slotFor(1090), papyrus_slot: slotFor(1088) };
  if (Object.values(slots).some((slot) => !Number.isInteger(slot))) {
    throw new Error("All three exact Genkai items must be present as quantity-one inventory entries.");
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");
  const trade = await client.callTool({
    name: "ffxi_trade_maat_genkai_items",
    arguments: {
      npc_index: maat.index,
      ...slots,
      confirmation: "TRADE EXACT MAAT GENKAI ITEMS",
    },
  });
  if (trade.isError) throw new Error("The exact Maat Genkai trade was rejected.");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const [after, afterState] = await Promise.all([
    client.callTool({ name: "ffxi_observe", arguments: { radius: 6, max_entities: 16, event_limit: 24 } }),
    client.callTool({ name: "ffxi_character_state", arguments: { inventory_container: 0, max_items: 80, include_recasts: false } }),
  ]);
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    target: maat,
    slots,
    trade: valueOf(trade),
    after: valueOf(after),
    after_state: valueOf(afterState),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close();
}
