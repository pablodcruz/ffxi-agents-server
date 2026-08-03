import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../server-extensions/commands/agentshop.lua", import.meta.url),
  "utf8",
);
const reloadSource = fs.readFileSync(
  new URL("../server-extensions/commands/agentreload.lua", import.meta.url),
  "utf8",
);
const spellSource = fs.readFileSync(
  new URL("../server-extensions/commands/agentspell.lua", import.meta.url),
  "utf8",
);

test("private-server shop preserves proximity, costs, ownership, and sale atomicity", () => {
  assert.match(source, /permission\s*=\s*1/);
  assert.match(source, /\[xi\.item\.ACHERON_SHIELD\]/);
  assert.match(source, /\[xi\.item\.IRON_SWORD\]/);
  assert.match(source, /\[xi\.item\.BROADSWORD\]/);
  assert.match(source, /\[xi\.item\.WILLOW_FISHING_ROD\]/);
  assert.match(source, /\[xi\.item\.LITTLE_WORM\]/);
  assert.match(source, /id\s*=\s*17735725, name\s*=\s*'Gelzerio'/);
  assert.match(source, /gilCost\s*=\s*75/);
  assert.match(source, /gilCost\s*=\s*4/);
  assert.match(source, /maxQuantity\s*=\s*99/);
  assert.match(source, /player:delGil\(cost\)/);
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
  for (const itemId of [90, 4401, 4426, 4427, 4472, 13454, 14117, 14242]) {
    assert.match(source, new RegExp(`\\[${itemId}\\]`));
  }
  assert.match(source, /maxSaleQuantity\s*=\s*12/);
  assert.match(source, /player:checkDistance\(npc\)/);
  assert.match(source, /maximumDistance\s*=\s*6/);
  assert.match(source, /player:getCurrency\('spark_of_eminence'\)/);
  assert.match(source, /player:delCurrency\('spark_of_eminence', cost\)/);
  assert.match(source, /WEEKLY_EXCHANGE_LIMIT/);
  assert.match(source, /npcUtil\.giveItem\(player/);
  assert.match(source, /player:getItemCount\(itemId\) < quantity/);
  assert.match(source, /config\.maxSaleQuantity or 1/);
  assert.match(source, /GetItemByID\(itemId\)/);
  assert.match(source, /item:getBasePrice\(\)/);
  assert.match(source, /\[8711\]/);
  assert.match(source, /voucherValue\s*=\s*1000/);
  assert.match(source, /player:hasItem\(itemId, container\)/);
  assert.match(source, /player:delItem\(itemId, 1, sourceContainer\)/);
  assert.match(source, /player:addCurrency\('spark_of_eminence', config\.voucherValue, xi\.settings\.main\.CAP_CURRENCY_SPARKS\)/);

  const removal = source.indexOf("player:delItem(itemId, quantity, xi.inv.INVENTORY)");
  const reward = source.indexOf("player:addGil(gil)");
  assert.ok(removal >= 0 && reward > removal, "item removal must precede gil reward");
  assert.doesNotMatch(source, /GetPlayerByName|setGil|givegil/);
});

test("private-server command reload refreshes the fixed shop module without arbitrary paths", () => {
  assert.match(reloadSource, /name\s*=\s*'agentshop', path\s*=\s*'scripts\/commands\/agentshop'/);
  assert.match(spellSource, /agentShopModulePath\s*=\s*'scripts\/commands\/agentshop'/);
  assert.match(spellSource, /package\.loaded\[agentShopModulePath\]\s*=\s*nil/);
  assert.match(spellSource, /pcall\(require, agentShopModulePath\)/);
  assert.doesNotMatch(reloadSource, /parameters\s*=\s*'s'/);
});
