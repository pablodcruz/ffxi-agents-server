import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../server-extensions/commands/agentmission.lua", import.meta.url),
  "utf8",
);

test("private-server mission helper is self-only and begins only Rank 3 missions", () => {
  assert.match(source, /permission\s*=\s*1/);
  assert.match(source, /THE_FOUR_MUSKETEERS/);
  assert.match(source, /TO_THE_FORSAKEN_MINES/);
  assert.match(source, /xi\.mission\.id\.bastok\.JEUNO/);
  assert.match(source, /getMissionRankPoints/);
  assert.match(source, /hasCompletedMission/);
  assert.match(source, /getCurrentMission/);
  assert.match(source, /player:addMission\(bastokLog, missionId\)/);
  assert.match(source, /player:delItem\(itemId, quantity\)/);
  assert.match(source, /player:addRankPoints\(appliedPoints\)/);
  assert.match(source, /4000 \/ \(rank \* 12 - crystalWorth\)/);
  assert.doesNotMatch(source, /completeMission|setMissionStatus|setRank|giveItem|addItem/);
});
