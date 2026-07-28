import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTravelNode,
  createTravelCache,
  markTravelNodeInteractionCompleted,
  markTravelNodeRegistered,
  registrationEvidence,
  routeEligibleTravelNodes,
  updateTravelCache,
} from "../src/travel-nodes.mjs";

test("classifies only exact known travel-object names", () => {
  assert.deepEqual(classifyTravelNode({ name: "Home Point #2" }), {
    type: "home_point",
    registration_method: "interact",
    safe_auto_registration: true,
  });
  assert.equal(classifyTravelNode({ name: "Home Point Helper" }), null);
  assert.deepEqual(classifyTravelNode({ name: "Outpost Gate" }), {
    type: "outpost",
    registration_method: "conquest_supply_quest",
    safe_auto_registration: false,
  });
});

test("preserves registration while refreshing observed node coordinates", () => {
  const cache = createTravelCache();
  const [node] = updateTravelCache(cache, {
    agentId: "primary",
    zoneId: 237,
    observedAt: "2026-07-28T12:00:00.000Z",
    entities: [{
      server_id: 17748183,
      name: "Home Point #2",
      position: { x: -78, y: 3, z: 2 },
    }],
  });
  markTravelNodeRegistered(cache, node.key, {
    verifiedAt: "2026-07-28T12:01:00.000Z",
    verification: "landsandboat:char_unlocks.homepoints",
  });

  updateTravelCache(cache, {
    agentId: "primary",
    zoneId: 237,
    observedAt: "2026-07-28T12:02:00.000Z",
    entities: [{
      server_id: 17748183,
      name: "Home Point #2",
      position: { x: -77.9, y: 3.1, z: 2 },
    }],
  });

  assert.equal(cache.nodes[node.key].registration_state, "registered");
  assert.equal(cache.nodes[node.key].first_observed_at, "2026-07-28T12:00:00.000Z");
  assert.deepEqual(cache.nodes[node.key].position, { x: -77.9, y: 3.1, z: 2 });
});

test("route planning sees only explicitly verified registrations", () => {
  const cache = createTravelCache();
  const nodes = updateTravelCache(cache, {
    agentId: "primary",
    zoneId: 237,
    entities: [
      {
        server_id: 10,
        name: "Home Point #1",
        position: { x: 1, y: 2, z: 3 },
      },
      {
        server_id: 11,
        name: "Survival Guide",
        position: { x: 4, y: 5, z: 6 },
      },
    ],
  });
  markTravelNodeRegistered(cache, nodes[1].key, {
    verification: "landsandboat:char_unlocks.survivals",
  });

  assert.deepEqual(
    routeEligibleTravelNodes(cache).map(({ server_id }) => server_id),
    [11],
  );
});

test("records safe interaction without making an unverified node route eligible", () => {
  const cache = createTravelCache();
  const [node] = updateTravelCache(cache, {
    agentId: "primary",
    zoneId: 107,
    entities: [{
      server_id: 20,
      name: "Survival Guide",
      distance: 2,
      position: { x: 1, y: 2, z: 3 },
    }],
  });
  markTravelNodeInteractionCompleted(cache, node.key);

  assert.equal(cache.nodes[node.key].registration_state, "interaction_completed");
  assert.deepEqual(routeEligibleTravelNodes(cache), []);
});

test("accepts only strict post-interaction system registration evidence", () => {
  const node = { type: "home_point" };
  assert.equal(registrationEvidence(node, [{
    timestamp: 10,
    mode: 1,
    message: "You have registered a new home point!",
  }], { since: 9 }), null);
  assert.deepEqual(registrationEvidence(node, [{
    timestamp: 8,
    mode: 919,
    message: "You have registered a new home point!",
  }, {
    timestamp: 10,
    mode: 919,
    message: "You have registered a new home point!",
  }], { since: 9 }), {
    timestamp: 10,
    mode: 919,
    message: "You have registered a new home point!",
  });
});
