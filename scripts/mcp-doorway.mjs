#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const targetName = argument("--target");
const serverId = Number(argument("--server-id"));
const destination = {
  x: Number(argument("--x")),
  y: Number(argument("--y")),
};

if (!targetName || targetName.length > 64 || /["\r\n;|]/.test(targetName)) {
  throw new Error("--target requires one exact safe door name.");
}
if (!Number.isInteger(serverId) || serverId <= 0) {
  throw new Error("--server-id requires the exact positive door ID from observation.");
}
if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y)) {
  throw new Error("Door traversal requires finite --x and --y coordinates.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-doorway", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function distance2d(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 12, max_entities: 24, event_limit: 16 },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  return valueOf(response);
}

async function waitForExactTarget() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const observation = await observe();
    if (observation.target?.server_id === serverId) return observation.target;
  }
  return null;
}

async function waitForMovement() {
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const status = await client.callTool({
      name: "ffxi_control_status",
      arguments: {},
    });
    if (status.isError) throw new Error("Could not read movement status.");
    if (!valueOf(status).movement) return;
  }
  throw new Error("Door traversal movement exceeded its timeout.");
}

let result;
let failure;

try {
  await client.connect(transport);
  const before = await observe();
  const door = before.nearby_entities.find((entity) => (
    entity.server_id === serverId
    && entity.name === targetName
    && entity.entity_type === 3
    && entity.distance <= 6
  ));
  if (!door) throw new Error("The exact nearby world-object door is unavailable.");
  if (distance2d(before.player.position, destination) > 15) {
    throw new Error("Door traversal destination must be within 15 yalms.");
  }

  const state = await client.callTool({
    name: "ffxi_character_state",
    arguments: { include_recasts: false },
  });
  if (state.isError || valueOf(state).menu_open || before.login_status !== 2) {
    throw new Error("Door traversal requires a logged-in character with menus closed.");
  }

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
      max_distance: 6,
    },
  });
  if (target.isError || !(await waitForExactTarget())) {
    throw new Error("The client did not accept the exact door target.");
  }

  const interaction = await client.callTool({
    name: "ffxi_interact",
    arguments: {
      mode: "target",
      server_id: serverId,
      name: targetName,
      max_distance: 6,
    },
  });
  if (interaction.isError) throw new Error("The exact door interaction was rejected.");
  await new Promise((resolve) => setTimeout(resolve, 250));

  const movement = await client.callTool({
    name: "ffxi_move_to_position",
    arguments: {
      x: destination.x,
      y: destination.y,
      max_start_distance: 20,
      stop_distance: 1,
      timeout_seconds: 8,
      stuck_seconds: 3,
    },
  });
  if (movement.isError) throw new Error("Could not start the through-door movement lease.");
  await waitForMovement();

  const after = await observe();
  const remaining = distance2d(after.player.position, destination);
  result = {
    protocol: "mcp-stdio",
    target: door,
    destination,
    before: before.player.position,
    after: after.player.position,
    remaining,
    arrived: remaining <= 2,
    recent_events: after.recent_events,
  };
} catch (error) {
  failure = error;
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}

if (result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.arrived) process.exitCode = 1;
}
if (failure) throw failure;
