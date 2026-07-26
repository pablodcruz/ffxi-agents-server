import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRegistry } from "../src/agent-registry.mjs";
import { BridgeError } from "../src/bridge-client.mjs";

async function writeRegistry(context, config) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-agent-registry-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "agents.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  return configPath;
}

test("rejects non-loopback agent endpoints", async (context) => {
  const configPath = await writeRegistry(context, {
    default_agent: "unsafe",
    agents: {
      unsafe: {
        host: "192.0.2.10",
        port: 19769,
        token: "test-token-at-least-24-characters",
      },
    },
  });

  assert.throws(
    () => new AgentRegistry({ configPath }),
    (error) => error instanceof BridgeError && error.code === "unsafe_agent_config",
  );
});

test(
  "rejects agent registries readable by group or other users",
  { skip: process.platform === "win32" },
  async (context) => {
    const configPath = await writeRegistry(context, {
      default_agent: "primary",
      agents: {
        primary: {
          host: "127.0.0.1",
          port: 19769,
          token: "test-token-at-least-24-characters",
        },
      },
    });
    await fs.chmod(configPath, 0o644);
    assert.throws(
      () => new AgentRegistry({ configPath }),
      (error) => error instanceof BridgeError && error.code === "unsafe_agent_config",
    );
  },
);

test("serializes writes per agent while preserving cross-agent concurrency", async (context) => {
  const configPath = await writeRegistry(context, {
    default_agent: "alpha",
    agents: {
      alpha: {
        host: "127.0.0.1",
        port: 19769,
        token: "alpha-token-at-least-24-characters",
      },
      beta: {
        host: "127.0.0.1",
        port: 19770,
        token: "beta-token-at-least-24-characters",
      },
    },
  });

  let active = 0;
  let maximumActive = 0;
  const auditEntries = [];
  const registry = new AgentRegistry({
    configPath,
    auditLogger: {
      record(entry) {
        auditEntries.push(entry);
      },
    },
    clientFactory: ({ port }) => ({
      async request(operation) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        if (operation === "fail") {
          throw new BridgeError("simulated failure", "simulated_error");
        }
        return { operation, port };
      },
    }),
  });

  assert.deepEqual(registry.list(), {
    default_agent: "alpha",
    agents: [
      { id: "alpha", host: "127.0.0.1", port: 19769 },
      { id: "beta", host: "127.0.0.1", port: 19770 },
    ],
  });

  await Promise.all([
    registry.request("alpha", "first", {}, { write: true }),
    registry.request("alpha", "second", {}, { write: true }),
  ]);
  assert.equal(maximumActive, 1);

  maximumActive = 0;
  await Promise.all([
    registry.request("alpha", "alpha_write", {}, { write: true }),
    registry.request("beta", "beta_write", {}, { write: true }),
  ]);
  assert.equal(maximumActive, 2);
  await assert.rejects(
    registry.request("alpha", "fail", {}, { write: true }),
    (error) => error instanceof BridgeError && error.code === "simulated_error",
  );
  assert.equal(auditEntries.length, 5);
  assert.deepEqual(
    auditEntries.slice(0, 2).map(({ agentId, operation, outcome }) => ({
      agentId,
      operation,
      outcome,
    })),
    [
      { agentId: "alpha", operation: "first", outcome: "ok" },
      { agentId: "alpha", operation: "second", outcome: "ok" },
    ],
  );
  assert.deepEqual(
    auditEntries
      .slice(2, 4)
      .map(({ agentId, operation, outcome }) => ({ agentId, operation, outcome }))
      .sort((left, right) => left.agentId.localeCompare(right.agentId)),
    [
      { agentId: "alpha", operation: "alpha_write", outcome: "ok" },
      { agentId: "beta", operation: "beta_write", outcome: "ok" },
    ],
  );
  assert.deepEqual(
    (({ agentId, operation, outcome, errorCode }) => ({
      agentId,
      operation,
      outcome,
      errorCode,
    }))(auditEntries[4]),
    {
      agentId: "alpha",
      operation: "fail",
      outcome: "error",
      errorCode: "simulated_error",
    },
  );
});
