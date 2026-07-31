import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectDir = path.resolve(import.meta.dirname, "..");

test("farm supervisor contains no calls to the retired immediate-stop helper", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /\bstopRequested\s*\(/);
  assert.match(source, /\blatchCooperativeStopRequest\s*\(/);
});

test("NM route delays Trust casts and exposes its NM kill counter", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  assert.match(source, /postZoneTrustDelayMilliseconds = 12_000/);
  assert.match(source, /interTrustSummonDelayMilliseconds = 2_000/);
  assert.match(source, /NMS KILLED \$\{counters\.notorious_monsters_killed\}/);
  assert.match(source, /summonTrusts/);
  assert.match(source, /post_placeholder_nm_sweep/);
  assert.match(source, /function trustSupportRequired\(\)/);
  assert.match(
    source,
    /Boolean\(currentNmRouteProfile\(\)\?\.requires_trusts\)/,
  );
});

test("farm supervisor verifies the startup zone before summoning Trusts", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  const verifyIndex = source.indexOf(
    "const initialSessionValid = verifySession(observation);",
  );
  const summonIndex = source.indexOf(
    "observation = await ensureTrustParty(observation);",
    verifyIndex,
  );
  assert.notEqual(verifyIndex, -1);
  assert.notEqual(summonIndex, -1);
  assert.ok(verifyIndex < summonIndex);
  assert.match(source, /while \(shouldContinueSupervisorLoop\(\{/);
});

test("exact-name objectives count confirmed kills and drain at their limit", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  assert.match(source, /function selectObjectiveTarget\(/);
  assert.match(source, /entity\.name === name/);
  assert.match(source, /objectiveTargetName \? objectiveTarget : \(nmRoute/);
  assert.match(source, /defeatedTarget\.name === objectiveTargetName/);
  assert.match(source, /stopReason = "objective_kill_limit"/);
  assert.match(source, /cooperativeStopRequestedAt \?\?= Date\.now\(\)/);
});
