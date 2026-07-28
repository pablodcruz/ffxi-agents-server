#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const exitX = Number(argument("--exit-x"));
const exitY = Number(argument("--exit-y"));
const boardXArgument = argument("--board-x");
const boardYArgument = argument("--board-y");
const boardX = boardXArgument === undefined ? undefined : Number(boardXArgument);
const boardY = boardYArgument === undefined ? undefined : Number(boardYArgument);
const triggerZ = Number(argument("--trigger-z"));
const direction = argument("--direction", "up");
const timeoutSeconds = Number(argument("--timeout", "60"));
const stopDistance = Number(argument("--stop-distance", "1"));
const stuckSeconds = Number(argument("--stuck-seconds", "8"));

if (![exitX, exitY, triggerZ].every(Number.isFinite)) {
  throw new Error(
    "Elevator exit requires finite --exit-x, --exit-y, and --trigger-z coordinates.",
  );
}
if (
  (boardX === undefined) !== (boardY === undefined)
  || (boardX !== undefined && ![boardX, boardY].every(Number.isFinite))
) {
  throw new Error(
    "Elevator boarding requires both finite --board-x and --board-y coordinates.",
  );
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 120) {
  throw new Error("--timeout must be from 5 through 120 seconds.");
}
if (!Number.isFinite(stopDistance) || stopDistance < 0.5 || stopDistance > 3) {
  throw new Error("--stop-distance must be from 0.5 through 3.");
}
if (!Number.isFinite(stuckSeconds) || stuckSeconds < 1 || stuckSeconds > 8) {
  throw new Error("--stuck-seconds must be from 1 through 8.");
}
if (!["up", "down"].includes(direction)) {
  throw new Error("--direction must be up or down.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-elevator", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 12, max_entities: 8, event_limit: 6 },
  });
  if (response.isError) throw new Error("Could not observe the elevator ride.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  const deadline = Date.now() + timeoutSeconds * 1000;
  const samples = [];
  const boardingAttempts = [];
  const attempts = [];
  let previous = await observe();
  let outcome = "timeout";
  let finalObservation = previous;
  let boarded = boardX === undefined;

  if (previous.login_status !== 2 || previous.player?.status !== 0) {
    throw new Error("Elevator coordination requires an idle, logged-in character.");
  }

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const current = await observe();
    finalObservation = current;
    const previousZ = previous.player?.position?.z;
    const currentZ = current.player?.position?.z;

    if (
      Number.isFinite(previousZ) &&
      Number.isFinite(currentZ) &&
      (samples.length === 0 || Math.abs(currentZ - samples.at(-1).z) >= 0.5)
    ) {
      samples.push({
        at_ms: timeoutSeconds * 1000 - (deadline - Date.now()),
        z: currentZ,
      });
    }

    if (!boarded) {
      const enable = await client.callTool({
        name: "ffxi_enable_control",
        arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
      });
      if (enable.isError) throw new Error("Could not arm elevator boarding control.");

      const movement = await client.callTool({
        name: "ffxi_move_to_position",
        arguments: {
          x: boardX,
          y: boardY,
          max_start_distance: 20,
          stop_distance: stopDistance,
          timeout_seconds: 3,
          stuck_seconds: 1,
        },
      });
      if (movement.isError) throw new Error("Could not attempt elevator boarding.");

      const boardingAttempt = {
        started: valueOf(movement).started,
      };
      const movementDeadline = Math.min(deadline, Date.now() + 3500);
      while (Date.now() < movementDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        finalObservation = await observe();
        if (!finalObservation.control?.movement) break;
      }

      const position = finalObservation.player?.position;
      const distance = position
        ? Math.hypot(boardX - position.x, boardY - position.y)
        : Number.POSITIVE_INFINITY;
      boardingAttempt.final_position = position;
      boardingAttempt.distance_to_board = distance;
      boardingAttempts.push(boardingAttempt);
      await client.callTool({ name: "ffxi_emergency_stop", arguments: {} });

      if (distance <= stopDistance + 0.75) {
        boarded = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      previous = finalObservation;
      continue;
    }

    const crossedTrigger =
      Number.isFinite(previousZ) &&
      Number.isFinite(currentZ) &&
      (
        direction === "up"
          ? previousZ > triggerZ && currentZ <= triggerZ && currentZ < previousZ
          : previousZ < triggerZ && currentZ >= triggerZ && currentZ > previousZ
      );

    if (!crossedTrigger) {
      previous = current;
      continue;
    }

    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm elevator exit control.");

    const movement = await client.callTool({
      name: "ffxi_move_to_position",
      arguments: {
        x: exitX,
        y: exitY,
        max_start_distance: 100,
        stop_distance: stopDistance,
        timeout_seconds: 8,
        stuck_seconds: stuckSeconds,
      },
    });
    if (movement.isError) throw new Error("Could not start the elevator exit.");

    const attempt = {
      trigger_z: currentZ,
      started: valueOf(movement).started,
    };
    const movementDeadline = Math.min(deadline, Date.now() + 8500);
    while (Date.now() < movementDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      finalObservation = await observe();
      if (!finalObservation.control?.movement) break;
    }

    const position = finalObservation.player?.position;
    const distance = position
      ? Math.hypot(exitX - position.x, exitY - position.y)
      : Number.POSITIVE_INFINITY;
    attempt.final_position = position;
    attempt.distance_to_exit = distance;
    attempts.push(attempt);

    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} });
    if (distance <= stopDistance + 0.75) {
      outcome = "exited";
      break;
    }

    previous = finalObservation;
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    outcome,
    exit: { x: exitX, y: exitY },
    direction,
    trigger_z: triggerZ,
    stuck_seconds: stuckSeconds,
    board: boardX === undefined ? null : { x: boardX, y: boardY },
    boarded,
    boarding_attempts: boardingAttempts,
    samples,
    attempts,
    final_position: finalObservation.player?.position,
  }, null, 2));

  if (outcome !== "exited") process.exitCode = 1;
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close();
}
