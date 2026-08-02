import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../server-extensions/commands/agentshop.lua", import.meta.url),
  "utf8",
);

test("private-server shop preserves proximity, costs, ownership, and sale atomicity", () => {
  assert.match(source, /permission\s*=\s*1/);
  assert.match(source, /\[xi\.item\.ACHERON_SHIELD\]/);
  assert.match(source, /\[xi\.item\.IRON_SWORD\]/);
  assert.match(source, /\[xi\.item\.BROADSWORD\]/);
  for (const itemId of [14326, 14425, 14857, 15164, 15314]) {
    assert.match(source, new RegExp(`\\[${itemId}\\]`));
  }
  assert.match(source, /sparksCost\s*=\s*132/);
  for (const cost of [80, 265, 84, 190, 124, 334]) {
    assert.match(source, new RegExp(`sparksCost\\s*=\\s*${cost}`));
  }
  assert.match(source, /sparksCost\s*=\s*2755/);
  assert.match(source, /id\s*=\s*17739953, name\s*=\s*'Isakoth'/);
  assert.match(source, /id\s*=\s*17739803, name\s*=\s*'Balthilda'/);
  assert.match(source, /player:checkDistance\(npc\)/);
  assert.match(source, /maximumDistance\s*=\s*6/);
  assert.match(source, /player:getCurrency\('spark_of_eminence'\)/);
  assert.match(source, /player:delCurrency\('spark_of_eminence', cost\)/);
  assert.match(source, /WEEKLY_EXCHANGE_LIMIT/);
  assert.match(source, /npcUtil\.giveItem\(player/);
  assert.match(source, /player:getItemCount\(itemId\) < quantity/);
  assert.match(source, /quantity ~= 1/);
  assert.match(source, /GetItemByID\(itemId\)/);
  assert.match(source, /item:getBasePrice\(\)/);
  assert.match(source, /\[8711\]/);
  assert.match(source, /voucherValue\s*=\s*1000/);
  assert.match(source, /player:hasItem\(itemId, container\)/);
  assert.match(source, /player:delItem\(itemId, 1, sourceContainer\)/);
  assert.match(source, /player:addCurrency\('spark_of_eminence', config\.voucherValue, xi\.settings\.main\.CAP_CURRENCY_SPARKS\)/);

  const removal = source.indexOf("player:delItem(itemId, quantity)");
  const reward = source.indexOf("player:addGil(gil)");
  assert.ok(removal >= 0 && reward > removal, "item removal must precede gil reward");
  assert.doesNotMatch(source, /GetPlayerByName|setGil|givegil/);
});
