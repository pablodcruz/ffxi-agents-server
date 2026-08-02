import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../ashita/addons/agentbridge/agentbridge.lua", import.meta.url),
  "utf8",
);

test("New Adventurer cancellation uses only the normal one-way config packet", () => {
  const start = source.indexOf("local function cancel_new_adventurer_status");
  const end = source.indexOf("local function monitor_movement", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const helper = source.slice(start, end);

  assert.match(helper, /CANCEL PRIVATE SERVER NEW ADVENTURER STATUS/);
  assert.match(helper, /0xDC, 0x0A, 0x00, 0x00/);
  assert.match(helper, /0x00, 0x00, 0x00, 0x04/);
  assert.match(helper, /0x01, 0x00, 0x00, 0x00/);
  assert.match(helper, /AddOutgoingPacket\(0x0DC, packet\)/);
  assert.doesNotMatch(helper, /QueueCommand|!exec|setNewPlayer/);
});
