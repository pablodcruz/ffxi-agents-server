import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMob,
  conservativeVendorValue,
  parseMobMetadataTsv,
  rankNearbyMobs,
  zoneMobIdRange,
} from "../src/mob-scout.mjs";

test("derives the zone-specific mob ID block", () => {
  assert.deepEqual(zoneMobIdRange(107), {
    start: 17215488,
    end: 17219584,
  });
});

test("parses LandSandBoat rows and maps database axes to AgentBridge axes", () => {
  const rows = [
    "17215530\tTunnel Worm\t1\t1\t313.868\t0.019\t-287.789\t2496\t0\t0\t0\t0\t0\t0\t0\t1000\t736\t150\tflint stone\t5",
    "17215530\tTunnel Worm\t1\t1\t313.868\t0.019\t-287.789\t2496\t0\t0\t0\t0\t0\t0\t0\t1000\t1126\t20\tbeastmen seal\t0",
  ].join("\n");
  const [mob] = parseMobMetadataTsv(rows, 107);

  assert.equal(mob.server_id, 17215530);
  assert.equal(mob.spawn_slot_id, 0);
  assert.deepEqual(mob.spawn, { x: 313.868, y: -287.789, z: 0.019 });
  assert.equal(mob.drops.length, 2);
  assert.equal(mob.conservative_vendor_value, 0.75);
});

test("computes only conservative nonzero vendor-value drop rates", () => {
  assert.equal(conservativeVendorValue([
    { group_rate: 1000, item_rate: 100, base_sell: 70 },
    { group_rate: 500, item_rate: 200, base_sell: 40 },
    { group_rate: 1000, item_rate: 0, base_sell: 500 },
  ]), 11);
});

test("ranks approved linked mobs before excluded hornets and worms", () => {
  const ranked = rankNearbyMobs({
    playerLevel: 4,
    observation: {
      player: { position: { z: 0 } },
      nearby_entities: [
        {
          server_id: 3,
          name: "Huge Hornet",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 2,
          position: { z: 0 },
        },
        {
          server_id: 2,
          name: "Walking Sapling",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 5,
          position: { z: 0 },
        },
        {
          server_id: 1,
          name: "Tunnel Worm",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 8,
          position: { z: 0 },
        },
      ],
    },
    metadata: [
      {
        server_id: 1,
        minimum_level: 1,
        maximum_level: 1,
        aggro: false,
        links: false,
        drops: [],
        conservative_vendor_value: 0.75,
      },
      {
        server_id: 2,
        minimum_level: 3,
        maximum_level: 6,
        aggro: false,
        links: false,
        drops: [],
        conservative_vendor_value: 16.5,
      },
      {
        server_id: 3,
        minimum_level: 1,
        maximum_level: 1,
        aggro: false,
        links: false,
        drops: [],
        conservative_vendor_value: 20,
      },
    ],
  });

  assert.deepEqual(
    ranked.map((mob) => [mob.server_id, mob.disposition]),
    [
      [2, "requires_exact_check"],
      [3, "avoid"],
      [1, "avoid"],
    ],
  );
  assert.deepEqual(ranked[1].reasons, ["excluded_mob_policy"]);
  assert.deepEqual(ranked[2].reasons, ["excluded_mob_policy"]);
});

test("excludes Stone Eaters even when their entity remains observable", () => {
  const [mob] = rankNearbyMobs({
    playerLevel: 9,
    observation: {
      player: { position: { z: 0 } },
      nearby_entities: [{
        server_id: 17215658,
        name: "Stone Eater",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 5,
        position: { z: 0 },
      }],
    },
    metadata: [{
      server_id: 17215658,
      minimum_level: 2,
      maximum_level: 3,
      aggro: false,
      links: false,
      drops: [],
      conservative_vendor_value: 3,
    }],
  });

  assert.equal(mob.disposition, "avoid");
  assert.deepEqual(mob.reasons, ["excluded_mob_policy"]);
});

test("excludes Vultures after target-follow still failed live registration", () => {
  const [mob] = rankNearbyMobs({
    playerLevel: 10,
    observation: {
      player: { position: { z: 0 } },
      nearby_entities: [{
        server_id: 17215675,
        name: "Vulture",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 2,
        position: { z: 0 },
      }],
    },
    metadata: [{
      server_id: 17215675,
      minimum_level: 3,
      maximum_level: 4,
      aggro: false,
      links: true,
      drops: [],
      conservative_vendor_value: 1.7,
    }],
  });

  assert.equal(mob.disposition, "avoid");
  assert.deepEqual(mob.reasons, ["excluded_mob_policy"]);
});

test("allows exact validated linked families while retaining other link exclusions", () => {
  const sheep = classifyMob({
    entity: {
      server_id: 201,
      name: "Mad Sheep",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      position: { z: 7 },
      player_z: 3.5,
    },
    metadata: {
      minimum_level: 12,
      maximum_level: 13,
      aggro: false,
      links: true,
    },
    playerLevel: 14,
  });
  const sapling = classifyMob({
    entity: {
      server_id: 202,
      name: "Strolling Sapling",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      position: { z: 7 },
      player_z: 3.5,
    },
    metadata: {
      minimum_level: 12,
      maximum_level: 13,
      aggro: false,
      links: true,
    },
    playerLevel: 14,
  });
  const hare = classifyMob({
    entity: {
      server_id: 203,
      name: "Sand Hare",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      position: { z: 0.3 },
      player_z: 0,
    },
    metadata: {
      minimum_level: 16,
      maximum_level: 17,
      aggro: false,
      links: true,
    },
    playerLevel: 15,
  });
  const tooHigh = classifyMob({
    entity: {
      server_id: 204,
      name: "Sand Hare",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      position: { z: 0.3 },
      player_z: 0,
    },
    metadata: {
      minimum_level: 17,
      maximum_level: 18,
      aggro: false,
      links: true,
    },
    playerLevel: 15,
  });
  assert.equal(sheep.disposition, "low_risk_candidate");
  assert.deepEqual(sheep.reasons, []);
  assert.equal(hare.disposition, "requires_exact_check");
  assert.deepEqual(hare.reasons, []);
  assert.equal(tooHigh.disposition, "avoid");
  assert.ok(tooHigh.reasons.includes("level_range_above_player"));
  assert.equal(sapling.disposition, "avoid");
  assert.ok(sapling.reasons.includes("links"));
});

test("temporarily cools down an exact server ID without hiding evidence", () => {
  const [mob] = rankNearbyMobs({
    playerLevel: 4,
    excludedServerIds: new Set([17215658]),
    observation: {
      player: { position: { z: 0 } },
      nearby_entities: [{
        server_id: 17215658,
        name: "Stone Eater",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 5,
        position: { z: 0 },
      }],
    },
    metadata: [{
      server_id: 17215658,
      minimum_level: 2,
      maximum_level: 3,
      aggro: false,
      links: false,
      drops: [],
      conservative_vendor_value: 3,
    }],
  });

  assert.equal(mob.disposition, "avoid");
  assert.deepEqual(mob.reasons, [
    "excluded_mob_policy",
    "temporary_target_cooldown",
  ]);
});
