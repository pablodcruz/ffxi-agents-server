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
  const policy = await fs.readFile(
    path.join(projectDir, "src", "farm-supervisor-policy.mjs"),
    "utf8",
  );
  assert.match(policy, /function selectObjectiveTarget\(/);
  assert.match(policy, /entity\?\.name === name/);
  assert.match(policy, /nearestNamedTarget\(primaryName\) \|\| nearestNamedTarget\(supportName\)/);
  assert.match(source, /objectiveTargetName \? objectiveTarget : \(nmRoute/);
  assert.match(source, /\[objectiveTargetName, objectiveSupportTargetName\]\.filter\(Boolean\)/);
  assert.match(source, /useServiceTeleport: Boolean\(/);
  assert.match(source, /recovery_method: useServiceTeleport \? "service_teleport" : "movement"/);
  assert.match(source, /ffxi_private_server_nm_reposition/);
  assert.match(source, /Number\(rejectedTarget\.attack_attempts\) >= 2/);
  assert.match(source, /\[17588674, 17588685\]\.includes/);
  assert.match(source, /Number\(retryTarget\.distance\) <= 10/);
  assert.match(source, /REPOSITION NEARBY PRIVATE SERVER NM/);
  assert.match(source, /defeatedTarget\.name === objectiveTargetName/);
  assert.match(source, /stopReason = "objective_kill_limit"/);
  assert.match(source, /cooperativeStopRequestedAt \?\?= Date\.now\(\)/);
});

test("NM route re-arms control after each zone transition settles", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /NM route transition to \$\{profile\.name\}[\s\S]*?await armControl\(\);[\s\S]*?activeZoneId = Number\(profile\.zone_id\)/,
  );
});
