#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  classifyProbe,
  collisionEvidence,
  CollisionProbeLog,
  generateProbeCandidates,
  withinArrivalDistance,
} from "../src/collision-probe.mjs";

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
const meshName = argument("--mesh", "South_Gustaberg.nav");
const maxProbes = Number(argument("--max-probes", "6"));
const stepDistance = Number(argument("--step-distance", "6"));
const minimumEntityDistance = Number(argument("--minimum-entity-distance", "12"));
const minimumHpPercent = Number(argument("--minimum-hp-percent", "90"));
const arrivalDistance = Number(argument("--arrival-distance", "2"));

if (Object.values(destination).some((value) => !Number.isFinite(value))) {
  throw new Error("Probe routing requires finite --x, --y, and --z coordinates.");
}
if (path.basename(meshName) !== meshName || !meshName.endsWith(".nav")) {
  throw new Error("--mesh must be one navmesh filename without directory components.");
}
if (!Number.isInteger(maxProbes) || maxProbes < 1 || maxProbes > 12) {
  throw new Error("--max-probes must be an integer from 1 through 12.");
}
if (!Number.isFinite(stepDistance) || stepDistance < 2 || stepDistance > 12) {
  throw new Error("--step-distance must be from 2 through 12.");
}
if (
  !Number.isFinite(minimumEntityDistance)
  || minimumEntityDistance < 8
  || minimumEntityDistance > 30
) {
  throw new Error("--minimum-entity-distance must be from 8 through 30.");
}
if (
  !Number.isFinite(minimumHpPercent)
  || minimumHpPercent < 50
  || minimumHpPercent > 100
) {
  throw new Error("--minimum-hp-percent must be from 50 through 100.");
}
if (!Number.isFinite(arrivalDistance) || arrivalDistance < 1 || arrivalDistance > 6) {
  throw new Error("--arrival-distance must be from 1 through 6.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-probe-route", version: "0.1.0" });
const probeLog = new CollisionProbeLog();
let connected = false;

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 50, max_entities: 64, event_limit: 8 },
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
  throw new Error("Probe movement exceeded its bounded wait.");
}

try {
  await client.connect(transport);
  connected = true;
  const history = probeLog.read({ mesh: meshName });
  const { visited, failedTargets } = collisionEvidence(history, { destination });
  const probes = [];
  let stopReason = "probe_limit";

  for (let index = 0; index < maxProbes; index += 1) {
    const before = await observe();
    const start = before.player?.position;
    if (!start) throw new Error("Player position is unavailable.");
    if (withinArrivalDistance(start, destination, arrivalDistance)) {
      stopReason = "arrived";
      break;
    }
    if (before.player.hp_percent < minimumHpPercent) {
      throw new Error(
        `Probe routing stopped at ${before.player.hp_percent}% HP.`,
      );
    }

    const nearbyThreat = before.nearby_entities.find((entity) => (
      entity.entity_type === 2 && entity.distance < minimumEntityDistance
    ));
    if (nearbyThreat) {
      throw new Error(
        `Probe routing refused to start within ${minimumEntityDistance} ` +
        `yalms of ${nearbyThreat.name}.`,
      );
    }

    const candidates = generateProbeCandidates({
      position: start,
      destination,
      stepDistance,
      visited,
      failedTargets,
      entities: before.nearby_entities,
      minimumEntityDistance,
    });
    const candidate = candidates[0];
    if (!candidate) {
      stopReason = "no_safe_untried_candidate";
      break;
    }

    const timeoutSeconds = Math.min(10, Math.max(4, Math.ceil(stepDistance / 2) + 2));
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");
    const movement = await client.callTool({
      name: "ffxi_move_to_position",
      arguments: {
        x: candidate.waypoint.x,
        y: candidate.waypoint.y,
        max_start_distance: 20,
        stop_distance: 1,
        timeout_seconds: timeoutSeconds,
        stuck_seconds: 3,
      },
    });
    if (movement.isError) throw new Error(`Probe ${index + 1} could not start.`);
    await waitForMovement(timeoutSeconds);
    const leaseStop = await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
    if (leaseStop.isError) {
      throw new Error(`Probe ${index + 1} could not disarm control.`);
    }

    const after = await observe();
    const classification = classifyProbe({
      start,
      target: candidate.waypoint,
      end: after.player.position,
    });
    const record = probeLog.append({
      mesh: meshName,
      agent_id: after.agent_id,
      destination,
      start,
      target: candidate.waypoint,
      end: after.player.position,
      ...classification,
      hp_percent: after.player.hp_percent,
    });
    probes.push(record);
    if (classification.outcome !== "arrived") {
      failedTargets.push(candidate.waypoint);
    }
    if (classification.outcome !== "stalled") {
      visited.push(after.player.position);
    }
  }

  const finalObservation = await observe();
  if (withinArrivalDistance(
    finalObservation.player.position,
    destination,
    arrivalDistance,
  )) {
    stopReason = "arrived";
  }
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
    mesh: meshName,
    destination,
    max_probes: maxProbes,
    step_distance: stepDistance,
    arrival_distance: arrivalDistance,
    stop_reason: stopReason,
    probes,
    final_position: finalObservation.player.position,
    hp_percent: finalObservation.player.hp_percent,
    emergency_stop: valueOf(emergencyStop),
    final_control: valueOf(finalControl),
  }, null, 2));
} finally {
  if (connected) {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
    await client.close();
  }
}
