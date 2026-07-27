import assert from "node:assert/strict";
import test from "node:test";
import { selectSafeTarget } from "../src/safe-target-selector.mjs";

const player = {
  position: { x: 0, y: 0, z: -20 },
};

test("selects the nearest exact-name target on the same elevation", () => {
  const target = selectSafeTarget({
    player,
    allowedNames: ["Ding Bats"],
    entities: [
      {
        name: "Ding Bats",
        server_id: 2,
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 9,
        position: { x: 9, y: 0, z: -19 },
      },
      {
        name: "Ding Bats",
        server_id: 1,
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 7,
        position: { x: 7, y: 0, z: -20 },
      },
    ],
  });
  assert.equal(target.server_id, 1);
});

test("rejects wrong names, corpses, distant entities, and vertical separation", () => {
  const target = selectSafeTarget({
    player,
    allowedNames: ["Ding Bats"],
    maximumDistance: 20,
    maximumElevationDifference: 4,
    entities: [
      {
        name: "Stone Eater",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 5,
        position: { z: -20 },
      },
      {
        name: "Ding Bats",
        entity_type: 2,
        status: 2,
        hp_percent: 0,
        distance: 6,
        position: { z: -20 },
      },
      {
        name: "Ding Bats",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 21,
        position: { z: -20 },
      },
      {
        name: "Ding Bats",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 8,
        position: { z: 0 },
      },
    ],
  });
  assert.equal(target, null);
});
