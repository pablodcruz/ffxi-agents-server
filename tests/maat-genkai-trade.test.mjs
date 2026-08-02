import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const bridge = fs.readFileSync(new URL("../ashita/addons/agentbridge/agentbridge.lua", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/mcp-server.mjs", import.meta.url), "utf8");

test("Maat Genkai trade is hardcoded to the exact NPC, items, quantities, and normal packet", () => {
  assert.match(bridge, /local npc_server_id = 17772593/);
  assert.match(bridge, /expected_item_ids = \{ 1089, 1090, 1088 \}/);
  assert.match(bridge, /item_index < 3 and 1 or 0/);
  assert.match(bridge, /table\.insert\(packet, 0x03\)/);
  assert.match(bridge, /AddOutgoingPacket\(0x036, packet\)/);
  assert.match(server, /ffxi_trade_maat_genkai_items/);
  assert.match(server, /TRADE EXACT MAAT GENKAI ITEMS/);
});
