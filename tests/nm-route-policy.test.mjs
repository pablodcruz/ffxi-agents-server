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

test("defines the guarded post-Jack NM route with unique exact IDs", () => {
  assert.deepEqual(
    NM_ROUTE_PROFILES.map((profile) => profile.name),
    [
      "Leaping Lizzy",
      "Stinging Sophie",
      "Spiny Spipi",
      "Valkurm Emperor",
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
    assert.equal(typeof profile.requires_trusts, "boolean");
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
  const spipi = NM_ROUTE_PROFILES.find((profile) => profile.id === "spiny_spipi");
  assert.equal(watchedItemsOwned(spipi, new Set()), false);
  assert.equal(watchedItemsOwned(spipi, new Set([13607])), true);
});

test("Valkurm Emperor owns a post-placeholder NM sweep", () => {
  const emperor = NM_ROUTE_PROFILES.find(
    (profile) => profile.id === "valkurm_emperor",
  );
  assert.equal(emperor.post_placeholder_nm_sweep, true);
  assert.equal(emperor.requires_trusts, true);
  assert.deepEqual(emperor.placeholder_server_ids, [17199434]);
  assert.deepEqual(emperor.notorious_monster_server_ids, [17199438]);
  assert.deepEqual(emperor.watched_items, [
    { item_id: 15224, name: "Empress Hairpin" },
  ]);
  assert.equal(emperor.sweep_positions[0].x, -228.957);
  assert.ok(emperor.sweep_positions.length > 1);
  assert.equal(
    NM_ROUTE_PROFILES
      .filter((profile) => profile.id !== "valkurm_emperor")
      .every((profile) => profile.requires_trusts === false),
    true,
  );
});

test("removes defeated placeholder IDs and enforces the visit cap", () => {
  const spipi = NM_ROUTE_PROFILES.find(
    (profile) => profile.id === "spiny_spipi",
  );
  const killed = new Set();
  assert.deepEqual(
    routePlaceholderIds(spipi, killed),
    spipi.placeholder_server_ids,
  );
  killed.add(spipi.placeholder_server_ids[0]);
  assert.deepEqual(routePlaceholderIds(spipi, killed), []);
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
