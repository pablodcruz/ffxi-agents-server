import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { farmStatus } from "../src/farm-supervisor-manager.mjs";

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
