import assert from "node:assert/strict";
import test from "node:test";
import {
  detourToFfxi,
  distance2d,
  ffxiToDetour,
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
