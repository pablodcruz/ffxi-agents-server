#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rankNearbyMobs } from "../src/mob-scout.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function argumentsFor(name) {
  return process.argv.flatMap((entry, index) => (
    entry === name && process.argv[index + 1]
      ? [process.argv[index + 1]]
      : []
  ));
}

const radius = Number(argument("--radius", "50"));
const maximumElevationDifference = Number(
  argument("--maximum-elevation-difference", "4"),
);
const limit = Number(argument("--limit", "12"));
const excludedServerIds = new Set(
  argumentsFor("--exclude-server-id").map(Number),
);

if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
  throw new Error("--radius must be from 1 through 50.");
}
if (
  !Number.isFinite(maximumElevationDifference)
  || maximumElevationDifference < 0
  || maximumElevationDifference > 20
) {
  throw new Error("--maximum-elevation-difference must be from 0 through 20.");
}
if (!Number.isInteger(limit) || limit < 1 || limit > 64) {
  throw new Error("--limit must be an integer from 1 through 64.");
}
if ([...excludedServerIds].some((id) => !Number.isInteger(id) || id <= 0)) {
  throw new Error("--exclude-server-id requires a positive integer.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-scout", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: {
      radius,
      max_entities: 64,
      event_limit: 12,
    },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  const observation = valueOf(response);
  const player = observation.party?.find((member) => member.slot === 0);
  const zoneId = Number(player?.zone_id);
  const playerLevel = Number(player?.main_job_level);
  if (!Number.isInteger(zoneId) || !Number.isInteger(playerLevel)) {
    throw new Error("The live observation did not include player zone and level.");
  }

  const metadataPath = path.join(
    projectDir,
    "runtime",
    "mob-metadata",
    `zone-${zoneId}.json`,
  );
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `No metadata for zone ${zoneId}. Run: pnpm mobs:export -- --zone-id ${zoneId}`,
      );
    }
    throw error;
  }
  if (metadata.schema_version !== 1 || metadata.zone_id !== zoneId) {
    throw new Error(`Unsupported or mismatched metadata file for zone ${zoneId}.`);
  }

  const ranked = rankNearbyMobs({
    observation,
    metadata: metadata.mobs,
    playerLevel,
    maximumElevationDifference,
    excludedServerIds,
  });
  const playerOperational = observation.login_status === 2
    && (observation.player?.hp_percent ?? 0) > 0
    && observation.player?.status !== 3;
  const actionable = playerOperational
    ? ranked.filter((mob) => mob.disposition !== "avoid")
    : [];

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mode: "read-only-scout",
    zone_id: zoneId,
    player_level: playerLevel,
    player: observation.player,
    player_operational: playerOperational,
    metadata_generated_at: metadata.generated_at,
    safety: {
      authoritative_combat_gate: "fresh exact-ID /check is still required",
      excluded_policy: ["mob names matching /hornet/i"],
      temporary_target_cooldowns: [...excludedServerIds],
      maximum_elevation_difference: maximumElevationDifference,
    },
    recommendation: actionable[0] || null,
    candidates: ranked.slice(0, limit),
    recent_events: observation.recent_events,
  }, null, 2));
} finally {
  await client.close();
}
