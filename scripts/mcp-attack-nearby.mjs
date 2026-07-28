#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rankNearbyMobs } from "../src/mob-scout.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const radius = Number(argument("--radius", "50"));
const combatTimeout = Number(argument("--combat-timeout", "120"));
const minimumStartHpPercent = Number(argument("--minimum-start-hp-percent", "90"));
const minimumHpPercent = Number(argument("--minimum-hp-percent", "40"));
const weaponSkill = argument("--weapon-skill", "Combo");
const teleportThreshold = Number(argument("--teleport-threshold", "8"));
const teleportOffset = Number(argument("--teleport-offset", "4"));
const excludedServerId = Number(argument("--exclude-server-id", "0"));

if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
  throw new Error("--radius must be from 1 through 50.");
}
if (
  !Number.isFinite(teleportThreshold)
  || teleportThreshold < 4
  || teleportThreshold > 20
) {
  throw new Error("--teleport-threshold must be from 4 through 20.");
}
if (!Number.isFinite(teleportOffset) || teleportOffset < 3 || teleportOffset > 6) {
  throw new Error("--teleport-offset must be from 3 through 6.");
}
if (!Number.isInteger(excludedServerId) || excludedServerId < 0) {
  throw new Error("--exclude-server-id must be a non-negative integer.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-attack-nearby",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

let selected;
let combatStartDistance = radius;
try {
  await client.connect(transport);
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius, max_entities: 64, event_limit: 6 },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  const observation = valueOf(response);
  const player = observation.party?.find((member) => member.slot === 0);
  const zoneId = Number(player?.zone_id);
  const playerLevel = Number(player?.main_job_level);
  if (
    observation.login_status !== 2
    || !Number.isInteger(zoneId)
    || !Number.isInteger(playerLevel)
    || (observation.player?.hp_percent ?? 0) < minimumStartHpPercent
  ) {
    throw new Error("Player is not operational or does not meet the start-HP gate.");
  }

  const metadata = JSON.parse(await fs.readFile(
    path.join(projectDir, "runtime", "mob-metadata", `zone-${zoneId}.json`),
    "utf8",
  ));
  selected = rankNearbyMobs({
    observation,
    metadata: metadata.mobs,
    playerLevel,
  }).find((mob) =>
    mob.disposition !== "avoid"
    && mob.distance <= radius
    && mob.server_id !== excludedServerId
  );
  if (!selected) {
    throw new Error(`No policy-approved active target found within ${radius} yalms.`);
  }
  console.error(
    `attack-nearby selected ${selected.name} (${selected.server_id}) at `
    + `${selected.distance.toFixed(1)} yalms; exact /check remains authoritative.`,
  );

  if (selected.distance > teleportThreshold) {
    const deltaX = observation.player.position.x - selected.position.x;
    const deltaY = observation.player.position.y - selected.position.y;
    const horizontalDistance = Math.hypot(deltaX, deltaY);
    const directionX = horizontalDistance > 0.01 ? deltaX / horizontalDistance : 1;
    const directionY = horizontalDistance > 0.01 ? deltaY / horizontalDistance : 0;
    const destination = {
      x: selected.position.x + (directionX * teleportOffset),
      y: selected.position.y + (directionY * teleportOffset),
      z: selected.position.z,
    };

    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm pre-combat positioning.");
    const teleport = await client.callTool({
      name: "ffxi_service_teleport",
      arguments: {
        ...destination,
        zone_id: zoneId,
        reason: "combat_position",
        confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
      },
    });
    if (teleport.isError) {
      throw new Error("Guarded pre-combat positioning was rejected.");
    }

    let positioned = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const positionedResponse = await client.callTool({
        name: "ffxi_observe",
        arguments: { radius: 20, max_entities: 32, event_limit: 8 },
      });
      if (positionedResponse.isError) continue;
      const positionedObservation = valueOf(positionedResponse);
      const position = positionedObservation.player?.position;
      if (
        positionedObservation.login_status === 2
        && position
        && Math.hypot(
          position.x - destination.x,
          position.y - destination.y,
          position.z - destination.z,
        ) <= 3
      ) {
        positioned = true;
        break;
      }
    }
    if (!positioned) {
      throw new Error("Pre-combat teleport did not converge on its safe offset.");
    }
    combatStartDistance = 20;
    console.error(
      `attack-nearby positioned at a ${teleportOffset.toFixed(1)}-yalm `
      + `offset from ${selected.name}; beginning exact-target combat.`,
    );
  }
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close();
}

const args = [
  path.join(projectDir, "scripts", "mcp-combat.mjs"),
  "--target", selected.name,
  "--server-id", String(selected.server_id),
  "--max-start-distance", String(Math.min(combatStartDistance, 40)),
  "--stop-distance", "3",
  "--approach-timeout", "20",
  "--combat-timeout", String(combatTimeout),
  "--minimum-start-hp-percent", String(minimumStartHpPercent),
  "--minimum-hp-percent", String(minimumHpPercent),
  "--commit-once-engaged",
  "--skip-recovery",
];
if (weaponSkill) args.push("--weapon-skill", weaponSkill);

const child = spawn(process.execPath, args, {
  cwd: projectDir,
  env: process.env,
  stdio: "inherit",
});
child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
