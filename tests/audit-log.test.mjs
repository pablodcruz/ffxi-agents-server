import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuditLogger } from "../src/audit-log.mjs";

test("writes restricted JSONL records and removes secret-shaped parameters", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-audit-log-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "audit", "actions.jsonl");
  const logger = new AuditLogger({
    filePath,
    clock: () => new Date("2026-07-25T21:00:00Z"),
  });

  logger.record({
    agentId: "primary",
    operation: "gameplay_command",
    params: {
      command: "/check <t>",
      token: "must-not-appear",
      nested: { password: "must-not-appear-either", safe: true },
    },
    outcome: "ok",
    durationMs: 12.7,
  });

  const entry = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.deepEqual(entry, {
    timestamp: "2026-07-25T21:00:00.000Z",
    agent_id: "primary",
    operation: "gameplay_command",
    params: {
      command: "/check <t>",
      nested: { safe: true },
    },
    outcome: "ok",
    duration_ms: 13,
  });

  if (process.platform !== "win32") {
    const status = await fs.stat(filePath);
    assert.equal(status.mode & 0o077, 0);
  }
});
