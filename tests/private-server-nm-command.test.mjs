import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const commandSource = fs.readFileSync(
  new URL("../server-extensions/commands/agentnmhere.lua", import.meta.url),
  "utf8",
);
const bridgeSource = fs.readFileSync(
  new URL("../ashita/addons/agentbridge/agentbridge.lua", import.meta.url),
  "utf8",
);
const composeSource = fs.readFileSync(
  new URL("../compose.yaml", import.meta.url),
  "utf8",
);

test("Argus collision recovery is exact, spawned-only, and proximity gated", () => {
  assert.match(commandSource, /permission\s*=\s*1/);
  assert.match(commandSource, /mazeOfShakhrami\s*=\s*198/);
  assert.match(commandSource, /maximumDistance\s*=\s*10/);
  assert.match(commandSource, /\[17588674\]\s*=\s*'Argus'/);
  assert.match(commandSource, /\[17588685\]\s*=\s*'Leech King'/);
  assert.match(commandSource, /not mob:isSpawned\(\)/);
  assert.match(commandSource, /player:checkDistance\(mob\)/);
  assert.match(commandSource, /mob:setPos\(/);
  assert.doesNotMatch(commandSource, /SpawnMob|DespawnMob|setHP|addItem|giveItem/);
});

test("client bridge repeats the exact collision-recovery safety checks", () => {
  assert.match(bridgeSource, /private_server_nm_reposition/);
  assert.match(bridgeSource, /REPOSITION NEARBY PRIVATE SERVER NM/);
  assert.match(bridgeSource, /party:GetMemberZone\(0\) ~= 198/);
  assert.match(bridgeSource, /entities:GetStatus\(player_index\) ~= 0/);
  assert.match(bridgeSource, /\[17588674\] = 'Argus'/);
  assert.match(bridgeSource, /\[17588685\] = 'Leech King'/);
  assert.match(bridgeSource, /found\.distance > 10/);
  assert.match(bridgeSource, /!agentnmhere %u/);
  assert.match(composeSource, /agentnmhere\.lua:\/server\/scripts\/commands\/agentnmhere\.lua:ro/);
});
