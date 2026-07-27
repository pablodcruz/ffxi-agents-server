import assert from "node:assert/strict";
import test from "node:test";
import {
  detourToFfxi,
  distance2d,
  ffxiToDetour,
  reachesDestination,
} from "../src/navmesh-planner.mjs";

test("converts between FFXI and Detour coordinate systems", () => {
  const ffxi = { x: -253.8, y: -93.3, z: -12 };
  const detour = ffxiToDetour(ffxi);
  assert.deepEqual(detour, { x: -253.8, y: 12, z: 93.3 });
  assert.deepEqual(detourToFfxi(detour), ffxi);
});

test("calculates horizontal FFXI waypoint distance", () => {
  assert.equal(distance2d({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("rejects a partial path that ends at a disconnected corridor edge", () => {
  const destination = { x: 10, y: 10, z: 0 };
  assert.equal(
    reachesDestination([{ x: 8, y: 8, z: -5 }], destination),
    true,
  );
  assert.equal(
    reachesDestination([{ x: 5, y: 5, z: 0 }], destination),
    false,
  );
  assert.equal(reachesDestination([], destination), false);
});
