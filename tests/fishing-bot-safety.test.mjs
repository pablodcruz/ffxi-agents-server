import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const bridge = fs.readFileSync(
  new URL("../ashita/addons/agentbridge/agentbridge.lua", import.meta.url),
  "utf8",
);
const compose = fs.readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const sellHelper = fs.readFileSync(
  new URL("../scripts/mcp-sell-inventory-item.mjs", import.meta.url),
  "utf8",
);

test("fishing bot is bounded to private-server starter fishing", () => {
  assert.match(compose, /XI_MAP_FISHING_ENABLE:\s*"true"/);
  assert.match(compose, /XI_MAP_FISHING_SKILL_MULTIPLIER:\s*"5\.0"/);
  assert.match(bridge, /START PRIVATE SERVER FISHING BOT/);
  assert.match(bridge, /\[234\]\s*=\s*true/);
  assert.match(bridge, /\[235\]\s*=\s*true/);
  assert.match(bridge, /\[236\]\s*=\s*true/);
  assert.match(bridge, /equipped_item_id\(inventory, 2\) ~= 17391/);
  assert.match(bridge, /fishing_bait_allowlist/);
  assert.match(bridge, /\[17395\]/);
  assert.match(bridge, /\[17396\]/);
  assert.match(bridge, /\[16998\]/);
  assert.match(bridge, /main_inventory_item_count\(inventory, bait_item_id\) <= 0/);
  assert.match(bridge, /minimum_free_inventory_slots/);
  assert.match(bridge, /maximum_seconds < 60 or maximum_seconds > 3600/);
  assert.match(bridge, /maximum_casts < 1 or maximum_casts > 200/);
  assert.match(bridge, /fishing_skill_snapshot\(\)\.skill >= bot\.target_skill/);
  assert.match(bridge, /stop_fishing_bot\('disconnect'\)/);
  assert.match(bridge, /stop_fishing_bot\('inventory_pressure'\)/);
  assert.match(bridge, /stop_fishing_bot\('missing_rod'\)/);
  assert.match(bridge, /stop_fishing_bot\('missing_bait'\)/);
  assert.match(bridge, /main_inventory_item_count\(inventory, item_id\)/);
  assert.match(bridge, /ensure_fishing_item_equipped/);
  assert.match(bridge, /rearm_%u_last_attempt_at/);
  assert.match(bridge, />= 3\.0/);
  assert.match(bridge, /<= 20\.0/);
  assert.match(bridge, /local update_fishing_overlay;/);
  assert.match(bridge, /update_fishing_overlay = function/);
  assert.match(bridge, /\/equip range \"Willow Fish\. Rod\"/);
  assert.match(bridge, /\/equip ammo \"Lugworm\"/);
  assert.match(bridge, /\/equip ammo \"Little Worm\"/);
  assert.match(bridge, /\/equip ammo \"Insect Ball\"/);
  assert.match(bridge, /bot\.phase == 'cooldown'/);
  assert.match(bridge, /message:find\(' caught a '\)/);
  assert.match(bridge, /message:find\(' caught an '\)/);
  for (const itemId of [4360, 4385, 4443, 4514]) {
    assert.match(
      bridge,
      new RegExp(`\\[${itemId}\\] = true,\\s+--`),
      `expected ordinary Port Bastok catch ${itemId} in the guarded NPC-sale allowlist`,
    );
    assert.match(
      sellHelper,
      new RegExp(`(?:^|\\s|,)${itemId}(?:\\s|,)`),
      `expected ordinary Port Bastok catch ${itemId} in the guarded host sale helper`,
    );
  }
  assert.match(
    bridge,
    /\[17735725\][\s\S]*?\[17391\] = true, -- Willow Fishing Rod/,
    "expected Gelzerio's Willow Fishing Rod in the guarded client purchase allowlist",
  );
});

test("fishing reel is a fixed normal packet with server-owned outcomes", () => {
  assert.match(bridge, /event\.id ~= 0x115/);
  assert.match(bridge, /read_u32_le\(event\.data, 0x14\)/);
  assert.match(bridge, /read_u32_le\(event\.data, 0x10\)/);
  assert.match(bridge, /hook_packet_layout = 'payload'/);
  assert.match(bridge, /data:byte\(offset \+ 1, offset \+ 4\)/);
  assert.match(bridge, /AddOutgoingPacket\(0x110, packet\)/);
  assert.match(bridge, /local packet = \{ 0x10, 0x15, 0x00, 0x00 \}/);
  assert.match(bridge, /send_fishing_hook_check_packet/);
  assert.match(bridge, /send_fishing_start_packet/);
  assert.match(bridge, /send_fishing_release_packet/);
  assert.match(bridge, /AddOutgoingPacket\(0x01A, packet\)/);
  assert.match(bridge, /append_u16\(packet, 0x0E\)/);
  assert.match(bridge, /bot\.phase = 'starting'/);
  assert.match(bridge, /Agent fishing hook %u observed; reel request %u queued/);
  assert.match(bridge, /bot\.phase = 'resolving'/);
  assert.match(bridge, /bot\.next_action_at = socket\.gettime\(\) \+ 6\.0/);
  assert.match(bridge, /packet\[#packet \+ 1\] = 2/);
  assert.match(bridge, /packet\[#packet \+ 1\] = 4/);
  assert.doesNotMatch(bridge, /QueueCommand\(1, '\/fish'\)/);
  assert.match(bridge, /normal_server_catch_checks = true/);
  assert.doesNotMatch(bridge, /fishing.*!additem|fishing.*setSkill/i);
});
