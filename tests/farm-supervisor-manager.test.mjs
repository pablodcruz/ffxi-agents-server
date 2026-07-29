import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FARM_CONFIRMATION,
  farmStatus,
  farmSupervisorArgs,
} from "../src/farm-supervisor-manager.mjs";

test("reports an idle farm supervisor without runtime state", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-farm-"));
  context.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  assert.deepEqual(await farmStatus({ projectDir }), {
    status: "idle",
    active: false,
  });
});

test("reports fresh and stale leases without exposing the process id", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-farm-"));
  context.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  const directory = path.join(projectDir, "runtime", "farm-supervisor");
  await fs.mkdir(directory, { recursive: true });
  const statePath = path.join(directory, "primary.json");
  const state = {
    lease_id: "lease-1",
    pid: 12345,
    status: "running",
    phase: "scouting",
    heartbeat_at_ms: Date.now(),
  };
  await fs.writeFile(statePath, JSON.stringify(state));

  const fresh = await farmStatus({ projectDir });
  assert.equal(fresh.active, true);
  assert.equal(fresh.pid, undefined);
  assert.ok(fresh.heartbeat_age_ms < 5000);

  await fs.writeFile(statePath, JSON.stringify({
    ...state,
    heartbeat_at_ms: Date.now() - 6000,
  }));
  const stale = await farmStatus({ projectDir });
  assert.equal(stale.active, false);
  assert.ok(stale.heartbeat_age_ms >= 5000);
});

test("passes the explicit caution opt-in to the detached supervisor process", () => {
  const args = farmSupervisorArgs({
    projectDir: "/private/test-project",
    agentId: "primary",
    leaseId: "00000000-0000-4000-8000-000000000001",
    zoneId: 108,
    maximumSeconds: 360,
    maximumFights: 3,
    scanRadius: 30,
    minimumStartHpPercent: 90,
    allowCaution: true,
    weaponSkill: "Combo",
  });
  assert.deepEqual(args, [
    "/private/test-project/scripts/mcp-farm-supervisor.mjs",
    "--agent-id", "primary",
    "--lease-id", "00000000-0000-4000-8000-000000000001",
    "--zone-id", "108",
    "--maximum-seconds", "360",
    "--maximum-fights", "3",
    "--scan-radius", "30",
    "--minimum-start-hp-percent", "90",
    "--allow-caution", "true",
    "--weapon-skill", "Combo",
    "--confirmation", FARM_CONFIRMATION,
  ]);
});
