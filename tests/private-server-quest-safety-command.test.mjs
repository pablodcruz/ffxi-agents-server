import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const commandSource = fs.readFileSync(
  new URL("../server-extensions/commands/agentquestsafety.lua", import.meta.url),
  "utf8",
);
const bridgeSource = fs.readFileSync(
  new URL("../ashita/addons/agentbridge/agentbridge.lua", import.meta.url),
  "utf8",
);

test("quest safety is explicit, quest-gated, reversible, and cannot advance Genkai", () => {
  assert.match(commandSource, /permission\s*=\s*1/);
  assert.match(commandSource, /IN_DEFIANT_CHALLENGE/);
  assert.match(commandSource, /QUEST_ACCEPTED/);
  assert.match(commandSource, /getLevelCap\(\) ~= 50/);
  assert.match(commandSource, /AgentQuestSafety/);
  assert.match(commandSource, /setGMHidden\(false\)/);
  assert.doesNotMatch(commandSource, /setGMHidden\(true\)/);
  assert.match(commandSource, /setUntargetable\(true\)/);
  assert.match(commandSource, /setUntargetable\(false\)/);
  assert.match(commandSource, /delStatusEffect/);
  assert.match(commandSource, /delMod/);
  assert.match(
    commandSource,
    /if player:getCharVar\(stateVar\) == 1 then\s+removeProtection\(player\)/,
  );
  assert.match(bridgeSource, /\['!agentquestsafety'\]\s*=\s*true/);
  for (const action of ["on", "off", "status"]) {
    assert.match(
      bridgeSource,
      new RegExp(`command == ['"]!agentquestsafety ${action}['"]`),
      `AgentBridge should accept the exact ${action} action`,
    );
  }
  assert.doesNotMatch(commandSource, /setLevelCap|completeQuest|addItem|giveItem|addKeyItem/);
});
