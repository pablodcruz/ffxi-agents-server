import assert from "node:assert/strict";
import test from "node:test";
import {
  selectExactLotteryTarget,
  selectQuestDropTarget,
  selectWatchedDropTarget,
} from "../src/quest-drop-policy.mjs";

const observation = {
  player: { position: { z: -9 } },
  nearby_entities: [
    {
      server_id: 10,
      name: "Snipper",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      distance: 8,
      position: { z: -9 },
    },
    {
      server_id: 11,
      name: "Thread Leech",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      distance: 3,
      position: { z: -9 },
    },
    {
      server_id: 12,
      name: "Snipper",
      entity_type: 2,
      status: 0,
      hp_percent: 100,
      distance: 5,
      position: { z: -9 },
    },
  ],
};
const metadata = [
  {
    server_id: 10,
    mob_type: 0,
    maximum_level: 20,
    drops: [{ item_id: 539, item_rate: 100 }],
  },
  {
    server_id: 11,
    mob_type: 0,
    maximum_level: 18,
    drops: [{ item_id: 999, item_rate: 1000 }],
  },
  {
    server_id: 12,
    mob_type: 0,
    maximum_level: 21,
    drops: [{ item_id: 539, item_rate: 100 }],
  },
];

test("selects only a live exact-name mob with the required pinned drop", () => {
  const selected = selectQuestDropTarget({
    observation,
    metadata,
    itemId: 539,
    allowedNames: ["Snipper"],
    playerLevel: 20,
  });
  assert.equal(selected.server_id, 10);
});

test("prefers a configured higher-rate drop family before level and distance", () => {
  const selected = selectQuestDropTarget({
    observation: {
      player: { position: { z: 0 } },
      nearby_entities: [
        {
          server_id: 606,
          name: "Amber Quadav",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 3,
          position: { z: 0 },
        },
        {
          server_id: 607,
          name: "Brass Quadav",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 12,
          position: { z: 0 },
        },
      ],
    },
    metadata: [
      {
        server_id: 606,
        mob_type: 0,
        maximum_level: 5,
        drops: [{ item_id: 607, item_rate: 250 }],
      },
      {
        server_id: 607,
        mob_type: 0,
        maximum_level: 23,
        drops: [{ item_id: 607, item_rate: 250 }],
      },
    ],
    itemId: 607,
    allowedNames: ["Amber Quadav", "Brass Quadav"],
    preferredNames: ["Brass Quadav"],
    playerLevel: 30,
  });
  assert.equal(selected.server_id, 607);
});

test("respects cooldown, elevation, level, and required-item evidence", () => {
  assert.equal(selectQuestDropTarget({
    observation,
    metadata,
    itemId: 539,
    allowedNames: ["Snipper"],
    playerLevel: 20,
    excludedServerIds: new Set([10, 12]),
  }), null);
  assert.equal(selectQuestDropTarget({
    observation: {
      ...observation,
      nearby_entities: [{
        ...observation.nearby_entities[0],
        position: { z: 20 },
      }],
    },
    metadata,
    itemId: 539,
    allowedNames: ["Snipper"],
    playerLevel: 20,
  }), null);
});

test("allows metadata-derived drop families when no explicit name list is supplied", () => {
  const selected = selectQuestDropTarget({
    observation: {
      player: { position: { z: 0 } },
      nearby_entities: [{
        server_id: 900,
        name: "Future Drop Mob",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 5,
        position: { z: 0 },
      }],
    },
    metadata: [{
      server_id: 900,
      mob_type: 0,
      maximum_level: 20,
      drops: [{ item_id: 600, item_rate: 100 }],
    }],
    itemId: 600,
    playerLevel: 20,
    allowedNames: [],
  });
  assert.equal(selected?.server_id, 900);
});

test("prefers a drop bearer, then admits its live spawn-slot placeholder", () => {
  const metadata = [
    {
      server_id: 700,
      spawn_slot_id: 9,
      mob_type: 0,
      maximum_level: 20,
      drops: [{ item_id: 538, item_rate: 150 }],
    },
    {
      server_id: 701,
      spawn_slot_id: 9,
      mob_type: 0,
      maximum_level: 20,
      drops: [],
    },
  ];
  const entity = (serverId, distance) => ({
    server_id: serverId,
    name: serverId === 700 ? "Ghoul" : "Goblin Leecher",
    entity_type: 2,
    status: 0,
    hp_percent: 100,
    distance,
    position: { z: 0 },
  });
  const base = {
    player: { position: { z: 0 } },
    nearby_entities: [entity(701, 2)],
  };
  assert.equal(
    selectWatchedDropTarget({
      observation: base,
      metadata,
      itemId: 538,
      playerLevel: 20,
    })?.watched_drop_role,
    "spawn_slot_placeholder",
  );
  assert.equal(
    selectWatchedDropTarget({
      observation: {
        ...base,
        nearby_entities: [entity(701, 2), entity(700, 8)],
      },
      metadata,
      itemId: 538,
      playerLevel: 20,
    })?.server_id,
    700,
  );
});

test("selects only exact lottery entities and prioritizes the notorious monster", () => {
  const entity = (serverId, name, distance) => ({
    server_id: serverId,
    name,
    entity_type: 2,
    status: 0,
    hp_percent: 100,
    distance,
    position: { z: 20 },
  });
  const selected = selectExactLotteryTarget({
    observation: {
      player: { position: { z: 20 } },
      nearby_entities: [
        entity(17215866, "Rock Lizard", 2),
        entity(17215867, "Rock Lizard", 4),
        entity(17215868, "Leaping Lizzy", 12),
      ],
    },
    metadata: [
      { server_id: 17215866, maximum_level: 8 },
      { server_id: 17215867, maximum_level: 8 },
      { server_id: 17215868, maximum_level: 11 },
    ],
    placeholderServerIds: [17215867],
    notoriousMonsterServerIds: [17215868, 17215888],
    playerLevel: 15,
  });
  assert.equal(selected?.server_id, 17215868);
  assert.equal(selected?.lottery_role, "notorious_monster");
});

test("falls back to the exact placeholder and respects cooldowns", () => {
  const options = {
    observation: {
      player: { position: { z: 20 } },
      nearby_entities: [{
        server_id: 17215867,
        name: "Rock Lizard",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 4,
        position: { z: 20 },
      }],
    },
    metadata: [{ server_id: 17215867, maximum_level: 8 }],
    placeholderServerIds: [17215867],
    notoriousMonsterServerIds: [17215868, 17215888],
    playerLevel: 15,
  };
  assert.equal(
    selectExactLotteryTarget(options)?.lottery_role,
    "placeholder",
  );
  assert.equal(selectExactLotteryTarget({
    ...options,
    excludedServerIds: new Set([17215867]),
  }), null);
});
