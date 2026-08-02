import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../server-extensions/commands/agentquestmarker.lua", import.meta.url),
  "utf8",
);

test("qm18 recovery is exact, proximity-gated, and cannot finish Genkai", () => {
  assert.match(source, /permission\s*=\s*1/);
  assert.match(source, /IN_DEFIANT_CHALLENGE/);
  assert.match(source, /QUEST_ACCEPTED/);
  assert.match(source, /getLevelCap\(\) ~= 50/);
  assert.match(source, /getZoneID\(\) ~= xi\.zone\.GARLAIGE_CITADEL/);
  assert.match(source, /qm18Id = 17596842/);
  assert.match(source, /checkDistance\(qm18\) > 10/);
  assert.match(source, /BOMB_COAL_FRAGMENT1/);
  assert.match(source, /BOMB_COAL_FRAGMENT2/);
  assert.match(source, /BOMB_COAL_FRAGMENT3/);
  assert.match(source, /giveItem\(player, xi\.item\.CHUNK_OF_BOMB_COAL\)/);
  assert.doesNotMatch(source, /setLevelCap|completeQuest|PIECE_OF_ANCIENT_PAPYRUS|CLUMP_OF_EXORAY_MOLD/);
});
