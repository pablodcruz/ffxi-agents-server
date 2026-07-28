#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCheckVerdict } from "../src/check-verdict.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const targetName = argument("--target");
const serverId = Number(argument("--server-id"));
const maximumDistance = Number(argument("--maximum-distance", "20"));
const targetabilityTimeoutSeconds = Number(
  argument("--targetability-timeout", "0"),
);
const retrySeconds = Number(argument("--retry-seconds", "2"));

if (!targetName || targetName.length > 64) {
  throw new Error("--target requires one exact name of at most 64 characters.");
}
if (/["\r\n;|]/.test(targetName)) {
  throw new Error("--target contains characters unsafe for a gameplay command.");
}
if (!Number.isInteger(serverId) || serverId <= 0) {
  throw new Error("--server-id requires the exact positive ID from observation.");
}
if (!Number.isFinite(maximumDistance) || maximumDistance < 1 || maximumDistance > 50) {
  throw new Error("--maximum-distance must be from 1 through 50.");
}
if (
  !Number.isFinite(targetabilityTimeoutSeconds)
  || targetabilityTimeoutSeconds < 0
  || targetabilityTimeoutSeconds > 30
) {
  throw new Error("--targetability-timeout must be from 0 through 30 seconds.");
}
if (!Number.isFinite(retrySeconds) || retrySeconds < 0.5 || retrySeconds > 5) {
  throw new Error("--retry-seconds must be from 0.5 through 5.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-check-target", version: "0.1.0" });
let connected = false;

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: {
      radius: maximumDistance,
      max_entities: 64,
      event_limit: 50,
    },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  return valueOf(response);
}

async function waitForExactTarget() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const observation = await observe();
    if (observation.target?.server_id === serverId) return observation;
  }
  return null;
}

async function waitForCheckVerdict(afterEventId) {
  const deadline = Date.now() + 3000;
  let observation;
  let result;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    observation = await observe();
    result = parseCheckVerdict(observation.recent_events, { afterEventId });
    if (result.verdict !== "unknown") return { observation, result };
  }
  return { observation, result };
}

function exactLiveEntity(observation) {
  return observation.nearby_entities.find((candidate) => (
    candidate.server_id === serverId
    && candidate.name === targetName
    && candidate.status === 0
    && candidate.hp_percent > 0
  ));
}

async function disarm() {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
}

async function attemptExactSelection() {
  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");
  const clearTarget = await client.callTool({
    name: "ffxi_clear_target",
    arguments: {},
  });
  if (clearTarget.isError || !valueOf(clearTarget).cleared) {
    throw new Error("Could not normalize the client target state.");
  }
  const target = await client.callTool({
    name: "ffxi_target_entity",
    arguments: {
      server_id: serverId,
      name: targetName,
      max_distance: maximumDistance,
    },
  });
  if (target.isError) return null;
  let selectionMethod = "bridge_target_setter";
  let verifiedTarget = await waitForExactTarget();
  if (!verifiedTarget) {
    const targetCommand = await client.callTool({
      name: "ffxi_gameplay_command",
      arguments: { command: `/target "${targetName}"` },
    });
    if (targetCommand.isError) return null;
    selectionMethod = "gameplay_target_command";
    verifiedTarget = await waitForExactTarget();
  }
  return verifiedTarget ? { selectionMethod, verifiedTarget } : null;
}

try {
  await client.connect(transport);
  connected = true;
  const before = await observe();
  const baselineEventId = Math.max(
    0,
    ...before.recent_events.map((event) => Number(event.id) || 0),
  );
  const targetabilityDeadline = Date.now() + (targetabilityTimeoutSeconds * 1000);
  let attempts = 0;
  let polls = 0;
  let entity;
  let selection;

  while (true) {
    const observation = polls === 0 ? before : await observe();
    polls += 1;
    entity = exactLiveEntity(observation);
    if (entity) {
      attempts += 1;
      selection = await attemptExactSelection();
      if (selection) break;
      await disarm();
    }
    if (Date.now() >= targetabilityDeadline) break;
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(retrySeconds * 1000, targetabilityDeadline - Date.now()),
    ));
  }

  if (!selection) {
    if (!entity) {
      throw new Error("The exact live target is not inside the observation radius.");
    }
    throw new Error("The client did not accept the exact target server ID.");
  }
  const check = await client.callTool({
    name: "ffxi_gameplay_command",
    arguments: { command: "/check <t>" },
  });
  if (check.isError) throw new Error("Could not queue /check.");

  const { result } = await waitForCheckVerdict(baselineEventId);
  const emergencyStop = await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: {},
  });
  const finalControl = await client.callTool({
    name: "ffxi_control_status",
    arguments: {},
  });

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mode: "non-combat-check",
    target: entity,
    selection_method: selection.selectionMethod,
    targetability: {
      attempts,
      polls,
      timeout_seconds: targetabilityTimeoutSeconds,
      retry_seconds: retrySeconds,
      disarmed_between_attempts: true,
    },
    result,
    emergency_stop: valueOf(emergencyStop),
    final_control: valueOf(finalControl),
  }, null, 2));
  if (result.verdict === "unknown") process.exitCode = 1;
} finally {
  if (connected) {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
    await client.close();
  }
}
