import assert from "node:assert/strict";
import test from "node:test";
import {
  NM_ROUTE_PROFILES,
  NM_ROUTE_SAFE_EXIT,
} from "../src/nm-route-profiles.mjs";
import {
  inventoryHasFreeSlots,
  nextRouteCamp,
  nextRoutePosition,
  routePlaceholderIds,
  watchedItemsOwned,
} from "../src/nm-route-policy.mjs";

test("defines the guarded four-camp NM route with unique exact IDs", () => {
  assert.deepEqual(
    NM_ROUTE_PROFILES.map((profile) => profile.name),
    [
      "Leaping Lizzy",
      "Stinging Sophie",
      "Jaggedy-Eared Jack",
      "Spiny Spipi",
    ],
  );
  const allServerIds = NM_ROUTE_PROFILES.flatMap((profile) => [
    ...profile.placeholder_server_ids,
    ...profile.notorious_monster_server_ids,
  ]);
  assert.equal(new Set(allServerIds).size, allServerIds.length);
  for (const profile of NM_ROUTE_PROFILES) {
    assert.ok(profile.zone_id > 0);
    assert.ok(profile.placeholder_server_ids.length > 0);
    assert.ok(profile.notorious_monster_server_ids.length > 0);
    assert.ok(profile.watched_items.length > 0);
    assert.ok(profile.sweep_positions.length > 0);
  }
  assert.deepEqual(NM_ROUTE_SAFE_EXIT, {
    name: "Bastok Markets",
    zone_id: 235,
    position: { x: -304, y: -161.5, z: -10.32 },
  });
});

test("requires configured inventory headroom", () => {
  assert.equal(inventoryHasFreeSlots({
    inventory: { count: 17, capacity: 30 },
  }, 5), true);
  assert.equal(inventoryHasFreeSlots({
    inventory: { count: 26, capacity: 30 },
  }, 5), false);
  assert.equal(inventoryHasFreeSlots({}, 5), false);
});

test("only skips a camp after every watched reward is owned", () => {
  const spipi = NM_ROUTE_PROFILES.at(-1);
  assert.equal(watchedItemsOwned(spipi, new Set()), false);
  assert.equal(watchedItemsOwned(spipi, new Set([13607])), true);
});

test("removes defeated placeholder IDs and enforces the visit cap", () => {
  const sophie = NM_ROUTE_PROFILES[1];
  const killed = new Set(sophie.placeholder_server_ids.slice(0, 2));
  assert.deepEqual(
    routePlaceholderIds(sophie, killed),
    sophie.placeholder_server_ids.slice(2),
  );
  killed.add(sophie.placeholder_server_ids[2]);
  assert.deepEqual(routePlaceholderIds(sophie, killed), []);
});

test("walks bounded sweep positions and advances rounds", () => {
  const lizzy = NM_ROUTE_PROFILES[0];
  assert.deepEqual(
    nextRoutePosition({ profile: lizzy, sweepIndex: 0 }),
    lizzy.sweep_positions[0],
  );
  assert.equal(
    nextRoutePosition({
      profile: lizzy,
      sweepIndex: lizzy.sweep_positions.length,
    }),
    null,
  );
  assert.deepEqual(nextRouteCamp({
    campIndex: 0,
    round: 1,
    profileCount: 4,
    maximumRounds: 2,
  }), {
    complete: false,
    camp_index: 1,
    round: 1,
  });
  assert.deepEqual(nextRouteCamp({
    campIndex: 3,
    round: 1,
    profileCount: 4,
    maximumRounds: 2,
  }), {
    complete: false,
    camp_index: 0,
    round: 2,
  });
  assert.deepEqual(nextRouteCamp({
    campIndex: 3,
    round: 2,
    profileCount: 4,
    maximumRounds: 2,
  }), {
    complete: true,
    camp_index: 3,
    round: 2,
  });
});
