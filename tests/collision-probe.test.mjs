import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyProbe,
  collisionEvidence,
  CollisionProbeLog,
  generateProbeCandidates,
  withinArrivalDistance,
} from "../src/collision-probe.mjs";

test("classifies arrived, partial, and stalled collision probes", () => {
  const start = { x: 0, y: 0 };
  const target = { x: 6, y: 0 };
  assert.equal(
    classifyProbe({ start, target, end: { x: 5.2, y: 0 } }).outcome,
    "arrived",
  );
  assert.equal(
    classifyProbe({ start, target, end: { x: 3, y: 0 } }).outcome,
    "partial_progress",
  );
  assert.equal(
    classifyProbe({ start, target, end: { x: 0.4, y: 0 } }).outcome,
    "stalled",
  );
});

test("checks bounded horizontal probe arrival", () => {
  assert.equal(
    withinArrivalDistance({ x: 0, y: 0 }, { x: 1, y: 1 }, 2),
    true,
  );
  assert.equal(
    withinArrivalDistance({ x: 0, y: 0 }, { x: 3, y: 0 }, 2),
    false,
  );
});

test("generates goal-biased candidates and rejects hazards and failed targets", () => {
  const candidates = generateProbeCandidates({
    position: { x: 0, y: 0 },
    destination: { x: 20, y: 0 },
    stepDistance: 6,
    failedTargets: [{ x: 6, y: 0 }],
    entities: [{ position: { x: 4.25, y: 4.25 } }],
    minimumEntityDistance: 3,
  });
  assert.equal(candidates.some(({ waypoint }) => waypoint.x === 6 && waypoint.y === 0), false);
  assert.equal(
    candidates.some(({ waypoint }) => (
      Math.abs(waypoint.x - 4.24) < 0.1
      && Math.abs(waypoint.y - 4.24) < 0.1
    )),
    false,
  );
  assert.ok(candidates.length > 0);
});

test("treats every unreached target as blocked while preserving reached nodes", () => {
  const arrived = {
    outcome: "arrived",
    destination: { x: 20, y: 0 },
    target: { x: 6, y: 0 },
    end: { x: 5.5, y: 0 },
  };
  const partial = {
    outcome: "partial_progress",
    destination: { x: 20, y: 0 },
    target: { x: 12, y: 0 },
    end: { x: 8, y: 0 },
  };
  const stalled = {
    outcome: "stalled",
    destination: { x: -20, y: 0 },
    target: { x: 8, y: 6 },
    end: { x: 8.2, y: 0 },
  };
  assert.deepEqual(collisionEvidence(
    [arrived, partial, stalled],
    { destination: { x: 20, y: 0 } },
  ), {
    visited: [arrived.end, partial.end],
    failedTargets: [partial.target, stalled.target],
  });
});

test("persists a private bounded collision probe log", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-probes-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "navigation", "probes.jsonl");
  const log = new CollisionProbeLog({
    filePath,
    clock: () => new Date("2026-07-27T21:30:00Z"),
  });
  log.append({
    mesh: "South_Gustaberg.nav",
    agent_id: "primary",
    destination: { x: 20, y: 0, z: 0 },
    start: { x: 0, y: 0, z: 0 },
    target: { x: 6, y: 0 },
    end: { x: 2, y: 0, z: 0 },
    outcome: "partial_progress",
    requested_distance: 6,
    displacement: 2,
    remaining: 4,
    hp_percent: 100,
    token: "must-not-be-written",
  });

  const [entry] = log.read({ mesh: "South_Gustaberg.nav" });
  assert.equal(entry.timestamp, "2026-07-27T21:30:00.000Z");
  assert.equal(entry.outcome, "partial_progress");
  assert.deepEqual(entry.destination, { x: 20, y: 0, z: 0 });
  assert.equal(JSON.stringify(entry).includes("must-not-be-written"), false);
  if (process.platform !== "win32") {
    const status = await fs.stat(filePath);
    assert.equal(status.mode & 0o077, 0);
  }
});
