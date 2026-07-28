#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  distance2d,
  planNavmeshPath,
  subdividePath,
} from "../src/navmesh-planner.mjs";
import { movementUnsafeReason } from "../src/navigation-safety.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const destination = {
  x: Number(argument("--x")),
  y: Number(argument("--y")),
  z: Number(argument("--z")),
};
const meshName = argument("--mesh", "Bastok_Markets.nav");
const meshPath = path.resolve(projectDir, "runtime", "navmeshes", meshName);
const planOnly = hasFlag("--plan-only");
const recoverStuck = hasFlag("--recover-stuck");
const maxReplans = Number(argument("--max-replans", "2"));
const maximumSegmentDistance = Number(argument("--maximum-segment-distance", "20"));
const recoveryPulseMs = Number(argument("--recovery-pulse-ms", "750"));

if (Object.values(destination).some((value) => !Number.isFinite(value))) {
  throw new Error("Pathfinding requires finite --x, --y, and --z coordinates.");
}
if (path.basename(meshName) !== meshName || !meshName.endsWith(".nav")) {
  throw new Error("--mesh must be one navmesh filename without directory components.");
}
if (!Number.isInteger(maxReplans) || maxReplans < 0 || maxReplans > 3) {
  throw new Error("--max-replans must be an integer from 0 through 3.");
}
if (
  !Number.isFinite(maximumSegmentDistance)
  || maximumSegmentDistance < 5
  || maximumSegmentDistance > 50
) {
  throw new Error("--maximum-segment-distance must be between 5 and 50 yalms.");
}
if (
  !Number.isInteger(recoveryPulseMs)
  || recoveryPulseMs < 50
  || recoveryPulseMs > 1000
) {
  throw new Error("--recovery-pulse-ms must be an integer from 50 through 1000.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-pathfind", version: "0.1.0" });
let connected = false;

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

async function waitForMovement(timeoutSeconds, baselineHpPercent) {
  const deadline = Date.now() + (timeoutSeconds * 1000) + 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const observation = await observe();
    const unsafeReason = movementUnsafeReason({
      loginStatus: observation.login_status,
      playerStatus: observation.player?.status,
      playerHpPercent: observation.player?.hp_percent,
      baselineHpPercent,
    });
    if (unsafeReason) {
      await client.callTool({ name: "ffxi_stop_movement", arguments: {} });
      throw new Error(`Navigation aborted: ${unsafeReason}.`);
    }
    if (!observation.control?.movement) return;
  }
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} });
}

try {
  await client.connect(transport);
  connected = true;
  const initial = await observe();
  const start = initial.player?.position;
  if (!start) throw new Error("Player position is unavailable.");
  const baselineHpPercent = initial.player?.hp_percent;
  const initialUnsafeReason = movementUnsafeReason({
    loginStatus: initial.login_status,
    playerStatus: initial.player?.status,
    playerHpPercent: baselineHpPercent,
    baselineHpPercent,
  });
  if (!planOnly && initialUnsafeReason) {
    throw new Error(`Navigation refused: ${initialUnsafeReason}.`);
  }

  const initialRawPathPoints = await planNavmeshPath({
    meshPath,
    start,
    end: destination,
  });
  const initialPathPoints = subdividePath(
    initialRawPathPoints,
    maximumSegmentDistance,
  );
  let route = initialPathPoints.slice(1);
  const completed = [];

  if (planOnly) {
    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      mode: "plan-only",
      mesh: meshName,
      start,
      destination,
      maximum_segment_distance: maximumSegmentDistance,
      recover_stuck: recoverStuck,
      recovery_pulse_ms: recoveryPulseMs,
      planned_waypoints: route.length,
      route: route.map((waypoint, index) => {
        const previous = index === 0 ? start : route[index - 1];
        return {
          index: index + 1,
          waypoint,
          distance_from_previous: distance2d(previous, waypoint),
          elevation_change: waypoint.z - previous.z,
        };
      }),
      total_distance: initialPathPoints
        .slice(1)
        .reduce(
          (total, waypoint, index) => (
            total + distance2d(initialPathPoints[index], waypoint)
          ),
          0,
        ),
    }, null, 2));
  } else {
    await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });

    let index = 0;
    let replanCount = 0;
    const recoveries = [];
    while (index < route.length) {
      const before = await observe();
      const waypoint = route[index];
      const startingDistance = distance2d(before.player.position, waypoint);
      if (startingDistance <= 1) {
        completed.push({
          plan: replanCount + 1,
          index: index + 1,
          waypoint,
          skipped: true,
        });
        index += 1;
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
      await waitForMovement(timeoutSeconds, baselineHpPercent);

      const after = await observe();
      const remaining = distance2d(after.player.position, waypoint);
      completed.push({
        plan: replanCount + 1,
        index: index + 1,
        waypoint,
        remaining,
        position: after.player.position,
      });
      if (remaining > 2) {
        if (replanCount < maxReplans) {
          let replanStart = after.player.position;
          if (recoverStuck) {
            const recovery = await client.callTool({
              name: "ffxi_directional_input",
              arguments: {
                action: "backward",
                duration_ms: recoveryPulseMs,
              },
            });
            if (recovery.isError) {
              throw new Error(
                `Navigation recovery failed after waypoint ${index + 1}.`,
              );
            }
            const recovered = await observe();
            replanStart = recovered.player.position;
            recoveries.push({
              plan: replanCount + 1,
              waypoint_index: index + 1,
              action: "backward",
              duration_ms: recoveryPulseMs,
              before: after.player.position,
              after: replanStart,
            });
          }
          const replannedRawPath = await planNavmeshPath({
            meshPath,
            start: replanStart,
            end: destination,
          });
          const replannedPath = subdividePath(
            replannedRawPath,
            maximumSegmentDistance,
          );
          replanCount += 1;
          route = replannedPath.slice(1);
          index = 0;
          continue;
        }
        throw new Error(
          `Navigation stopped ${remaining.toFixed(2)} yalms from waypoint ` +
          `${index + 1} after ${replanCount} replans.`,
        );
      }
      index += 1;
    }

    const finalObservation = await observe();
    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      mode: "execute",
      mesh: meshName,
      destination,
      initial_planned_waypoints: initialPathPoints.length - 1,
      replans: replanCount,
      recover_stuck: recoverStuck,
      recoveries,
      completed,
      final_position: finalObservation.player.position,
      remaining: distance2d(finalObservation.player.position, destination),
    }, null, 2));
  }
} finally {
  if (connected) {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
    await client.close();
  }
}
