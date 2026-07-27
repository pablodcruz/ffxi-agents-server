#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { distance2d, planNavmeshPath } from "../src/navmesh-planner.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const destination = {
  x: Number(argument("--x")),
  y: Number(argument("--y")),
  z: Number(argument("--z")),
};
const meshName = argument("--mesh", "Bastok_Markets.nav");
const meshPath = path.resolve(projectDir, "runtime", "navmeshes", meshName);

if (Object.values(destination).some((value) => !Number.isFinite(value))) {
  throw new Error("Pathfinding requires finite --x, --y, and --z coordinates.");
}
if (path.basename(meshName) !== meshName || !meshName.endsWith(".nav")) {
  throw new Error("--mesh must be one navmesh filename without directory components.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-pathfind", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 12, max_entities: 8, event_limit: 6 },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  return valueOf(response);
}

async function waitForMovement(timeoutSeconds) {
  const deadline = Date.now() + (timeoutSeconds * 1000) + 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await client.callTool({
      name: "ffxi_control_status",
      arguments: {},
    });
    if (response.isError) throw new Error("Could not read movement status.");
    if (!valueOf(response).movement) return;
  }
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} });
}

try {
  await client.connect(transport);
  const initial = await observe();
  const start = initial.player?.position;
  if (!start) throw new Error("Player position is unavailable.");

  const pathPoints = await planNavmeshPath({
    meshPath,
    start,
    end: destination,
  });
  const route = pathPoints.slice(1);
  const completed = [];

  await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });

  for (let index = 0; index < route.length; index += 1) {
    const before = await observe();
    const waypoint = route[index];
    const startingDistance = distance2d(before.player.position, waypoint);
    if (startingDistance <= 1) {
      completed.push({ index: index + 1, waypoint, skipped: true });
      continue;
    }

    const timeoutSeconds = Math.min(
      20,
      Math.max(4, Math.ceil(startingDistance / 2) + 2),
    );
    const movement = await client.callTool({
      name: "ffxi_move_to_position",
      arguments: {
        x: waypoint.x,
        y: waypoint.y,
        max_start_distance: 100,
        stop_distance: 1,
        timeout_seconds: timeoutSeconds,
        stuck_seconds: 3,
      },
    });
    if (movement.isError) {
      throw new Error(`Waypoint ${index + 1} could not start.`);
    }
    await waitForMovement(timeoutSeconds);

    const after = await observe();
    const remaining = distance2d(after.player.position, waypoint);
    completed.push({
      index: index + 1,
      waypoint,
      remaining,
      position: after.player.position,
    });
    if (remaining > 2) {
      throw new Error(
        `Navigation stopped ${remaining.toFixed(2)} yalms from waypoint ${index + 1}.`,
      );
    }
  }

  const finalObservation = await observe();
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mesh: meshName,
    destination,
    planned_waypoints: route.length,
    completed,
    final_position: finalObservation.player.position,
    remaining: distance2d(finalObservation.player.position, destination),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} })
    .catch(() => {});
  await client.close();
}
