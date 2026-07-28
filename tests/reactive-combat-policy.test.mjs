import assert from "node:assert/strict";
import test from "node:test";
import {
  playerPartyMember,
  reactiveThreatSignal,
  selectReactiveThreat,
} from "../src/reactive-combat-policy.mjs";

function observation(overrides = {}) {
  return {
    player: {
      server_id: 1,
      hp_percent: 90,
      status: 0,
    },
    target: null,
    party: [
      { slot: 0, server_id: 1, tp: 800 },
      { slot: 1, server_id: 2, tp: 0 },
    ],
    nearby_entities: [],
    ...overrides,
  };
}

test("keeps the exact engaged target before choosing the nearest add", () => {
  const observed = observation({
    target: { server_id: 12 },
    nearby_entities: [
      { server_id: 11, status: 1, hp_percent: 80, distance: 2 },
      { server_id: 12, status: 1, hp_percent: 90, distance: 5 },
    ],
  });
  assert.equal(selectReactiveThreat(observed)?.server_id, 12);
});

test("selects the nearest live engaged non-party entity", () => {
  const observed = observation({
    nearby_entities: [
      { server_id: 2, status: 1, hp_percent: 100, distance: 1 },
      { server_id: 20, status: 0, hp_percent: 100, distance: 2 },
      { server_id: 21, status: 1, hp_percent: 0, distance: 3 },
      { server_id: 22, status: 1, hp_percent: 70, distance: 14 },
      { server_id: 23, status: 1, hp_percent: 90, distance: 6 },
      { server_id: 24, status: 1, hp_percent: 60, distance: 4 },
    ],
  });
  assert.equal(selectReactiveThreat(observed, { maxDistance: 12 })?.server_id, 24);
  assert.equal(
    selectReactiveThreat(observed, {
      maxDistance: 12,
      excludedServerIds: [24],
    })?.server_id,
    23,
  );
});

test("requires combat evidence unless explicitly leased to a private solo instance", () => {
  const idle = observation();
  assert.equal(reactiveThreatSignal({
    observation: idle,
    previousHpPercent: 90,
    now: 500,
  }).active, false);
  assert.equal(reactiveThreatSignal({
    observation: idle,
    previousHpPercent: 100,
    now: 500,
  }).hpDropped, true);
  assert.equal(reactiveThreatSignal({
    observation: idle,
    previousHpPercent: 90,
    threatWindowUntil: 1000,
    now: 500,
  }).withinThreatWindow, true);
  assert.equal(reactiveThreatSignal({
    observation: idle,
    previousHpPercent: 90,
    now: 500,
    privateSolo: true,
  }).active, true);
});

test("finds the player party member for TP decisions", () => {
  assert.equal(playerPartyMember(observation())?.server_id, 1);
});
