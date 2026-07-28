#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  playerPartyMember,
  reactiveThreatSignal,
  selectReactiveThreat,
} from "../src/reactive-combat-policy.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
const PRIVATE_SOLO_CONFIRMATION = "ARM PRIVATE SERVER SOLO AGGRO GUARD";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const zoneId = Number(argument("--zone-id", "0"));
const maxDistance = Number(argument("--max-distance", "12"));
const pollMilliseconds = Number(argument("--poll-ms", "250"));
const maximumSeconds = Number(argument("--maximum-seconds", "900"));
const maximumEngagements = Number(argument("--maximum-engagements", "30"));
const weaponSkill = argument("--weapon-skill", "Combo");
const privateSolo = argument("--confirmation") === PRIVATE_SOLO_CONFIRMATION;

if (!Number.isInteger(zoneId) || zoneId <= 0) {
  throw new Error("--zone-id must be the exact positive zone ID for this lease.");
}
if (!Number.isFinite(maxDistance) || maxDistance < 3 || maxDistance > 20) {
  throw new Error("--max-distance must be from 3 through 20.");
}
if (
  !Number.isInteger(pollMilliseconds)
  || pollMilliseconds < 100
  || pollMilliseconds > 1000
) {
  throw new Error("--poll-ms must be an integer from 100 through 1000.");
}
if (
  !Number.isInteger(maximumSeconds)
  || maximumSeconds < 10
  || maximumSeconds > 3600
) {
  throw new Error("--maximum-seconds must be an integer from 10 through 3600.");
}
if (
  !Number.isInteger(maximumEngagements)
  || maximumEngagements < 1
  || maximumEngagements > 200
) {
  throw new Error("--maximum-engagements must be an integer from 1 through 200.");
}
if (!privateSolo) {
  throw new Error(
    `Aggro guard requires --confirmation "${PRIVATE_SOLO_CONFIRMATION}".`,
  );
}
if (
  weaponSkill
  && (
    weaponSkill.length > 64
    || /["\r\n;|]/.test(weaponSkill)
  )
) {
  throw new Error("--weapon-skill contains unsafe gameplay-command characters.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-aggro-guard",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(`${name} failed.`);
  return valueOf(response);
}

async function observe() {
  return call("ffxi_observe", {
    radius: Math.max(maxDistance, 20),
    max_entities: 64,
    event_limit: 12,
  });
}

async function command(text) {
  return call("ffxi_gameplay_command", { command: text });
}

async function armControl() {
  return call("ffxi_enable_control", {
    confirmation: "ENABLE PRIVATE SERVER CONTROL",
  });
}

async function selectExactThreat(threat) {
  // Other bounded MCP actions intentionally finish with emergency_stop. Re-arm
  // immediately before this guard's own exact-target write sequence so the
  // defensive lease can coexist with a high-level farming or travel action.
  await armControl();
  await call("ffxi_clear_target");
  await call("ffxi_target_entity", {
    name: threat.name,
    server_id: threat.server_id,
    max_distance: maxDistance,
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const observation = await observe();
    if (Number(observation.target?.server_id) === Number(threat.server_id)) {
      return observation;
    }
  }
  throw new Error(`Exact threat target verification failed for ${threat.name}.`);
}

let stopping = false;
let stopReason = "lease_complete";
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    stopReason = signal.toLowerCase();
  });
}

let engagements = 0;
let currentThreatId = 0;
let previousHpPercent;
let threatWindowUntil = 0;
let lastWeaponSkillAt = 0;
const startedAt = Date.now();

try {
  await client.connect(transport);
  await armControl();
  console.log(JSON.stringify({
    event: "aggro_guard_armed",
    zone_id: zoneId,
    poll_ms: pollMilliseconds,
    max_distance: maxDistance,
    maximum_seconds: maximumSeconds,
    maximum_engagements: maximumEngagements,
    private_solo: true,
  }));

  while (!stopping) {
    if (Date.now() - startedAt >= maximumSeconds * 1000) {
      stopReason = "time_limit";
      break;
    }
    if (engagements >= maximumEngagements) {
      stopReason = "engagement_limit";
      break;
    }

    const observation = await observe();
    const partyPlayer = playerPartyMember(observation);
    const observedZoneId = Number(partyPlayer?.zone_id);
    if (observation.login_status !== 2) {
      stopReason = "not_logged_in";
      break;
    }
    if (observedZoneId !== zoneId) {
      stopReason = `zone_changed:${observedZoneId || "unknown"}`;
      break;
    }
    if ((observation.player?.hp_percent ?? 0) <= 0) {
      stopReason = "player_defeated";
      break;
    }

    const signal = reactiveThreatSignal({
      observation,
      previousHpPercent,
      threatWindowUntil,
      now: Date.now(),
      privateSolo,
    });
    if (signal.hpDropped || signal.playerFighting) {
      threatWindowUntil = Date.now() + 8000;
    }
    previousHpPercent = observation.player?.hp_percent;

    const threat = signal.active
      ? selectReactiveThreat(observation, { maxDistance })
      : null;
    if (!threat) {
      if (currentThreatId && Date.now() > threatWindowUntil) {
        console.log(JSON.stringify({
          event: "aggro_guard_idle",
          completed_threat_id: currentThreatId,
        }));
        currentThreatId = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
      continue;
    }

    if (Number(threat.server_id) !== currentThreatId) {
      const targetedObservation = await selectExactThreat(threat);
      await command("/attack <t>");
      currentThreatId = Number(threat.server_id);
      engagements += 1;
      threatWindowUntil = Date.now() + 8000;
      console.log(JSON.stringify({
        event: "aggro_guard_engaged",
        engagement: engagements,
        name: threat.name,
        server_id: threat.server_id,
        distance: threat.distance,
        player_hp_percent: targetedObservation.player?.hp_percent,
      }));
    }

    const exactTarget = Number(observation.target?.server_id) === currentThreatId;
    const targetHpPercent = exactTarget
      ? Number(observation.target?.hp_percent)
      : Number(threat.hp_percent);
    if (
      weaponSkill
      && exactTarget
      && Number(partyPlayer?.tp) >= 1000
      && targetHpPercent >= 10
      && Date.now() - lastWeaponSkillAt >= 5000
    ) {
      await armControl();
      await command(`/ws "${weaponSkill}" <t>`);
      lastWeaponSkillAt = Date.now();
      console.log(JSON.stringify({
        event: "aggro_guard_weapon_skill",
        name: weaponSkill,
        server_id: currentThreatId,
        tp: partyPlayer.tp,
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
} finally {
  await command("/attackoff").catch(() => {});
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
  console.log(JSON.stringify({
    event: "aggro_guard_stopped",
    reason: stopReason,
    engagements,
    elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
  }));
}
