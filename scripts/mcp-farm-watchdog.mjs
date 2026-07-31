#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  FARM_CONFIRMATION,
  farmStatus,
  startFarm,
  stopFarm,
} from "../src/farm-supervisor-manager.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
const WATCHDOG_CONFIRMATION = "ARM PRIVATE SERVER FARM WATCHDOG";
const restartableReasons = new Set(["time_limit", "fight_limit"]);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(value, name, { minimum = 1, maximum = 3600 } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

const agentId = argument("--agent-id", "primary");
const intervalSeconds = positiveInteger(
  argument("--interval-seconds", "15"),
  "--interval-seconds",
  { minimum: 5, maximum: 300 },
);
const stopAfterNmKills = positiveInteger(
  argument("--stop-after-nm-kills", "0"),
  "--stop-after-nm-kills",
  { minimum: 0, maximum: 1000 },
);
if (argument("--confirmation") !== WATCHDOG_CONFIRMATION) {
  throw new Error(
    `Watchdog start requires --confirmation "${WATCHDOG_CONFIRMATION}".`,
  );
}

const runtimeDirectory = path.join(projectDir, "runtime", "farm-monitor");
const statePath = path.join(runtimeDirectory, `${agentId}.json`);
let stopping = false;
let lastLeaseId = null;
let lastDisposition = null;
let renewals = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeState({
  status,
  disposition,
  farm,
  lastError = null,
}) {
  await fs.mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(runtimeDirectory, 0o700);
  await fs.writeFile(
    statePath,
    `${JSON.stringify({
      schema_version: 1,
      agent_id: agentId,
      pid: process.pid,
      status,
      disposition,
      heartbeat_at_ms: Date.now(),
      interval_seconds: intervalSeconds,
      stop_after_nm_kills: stopAfterNmKills,
      renewals,
      observed_lease_id: farm?.lease_id || null,
      observed_farm_status: farm?.status || "idle",
      observed_stop_reason: farm?.stop_reason || null,
      observed_heartbeat_age_ms: farm?.heartbeat_age_ms ?? null,
      last_error: lastError,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function configForRenewal(farm) {
  const config = farm.config;
  return {
    projectDir,
    agentId,
    zoneId: config.nm_route
      ? Number(farm.active_zone_id ?? config.zone_id)
      : config.zone_id,
    maximumSeconds: config.maximum_seconds,
    maximumFights: config.maximum_fights,
    scanRadius: config.scan_radius,
    minimumStartHpPercent: config.minimum_start_hp_percent,
    allowCaution: config.allow_caution,
    autoRelocate: config.auto_relocate,
    autoTransition: config.auto_transition,
    targetLevel: config.target_level,
    questItemId: config.quest_item_id,
    trustedCampSweep: config.trusted_camp_sweep,
    maximumTargetLevelOffset: config.maximum_target_level_offset ?? 1,
    autoJobAbilities: config.auto_job_abilities,
    summonTrusts: config.summon_trusts ?? true,
    weaponSkill: config.weapon_skill,
    combatSpell: config.combat_spell,
    maximumCombatSpellsPerFight: config.maximum_combat_spells_per_fight,
    minimumCastMpPercent: config.minimum_cast_mp_percent,
    nmRoute: config.nm_route,
    maximumRouteRounds: config.maximum_route_rounds,
    minimumFreeInventorySlots: config.minimum_free_inventory_slots,
    objectiveTargetName: config.objective_target_name ?? "",
    objectiveKillCount: config.objective_kill_count ?? 0,
    confirmation: FARM_CONFIRMATION,
  };
}

function logTransition(farm, disposition) {
  const leaseId = farm?.lease_id || null;
  if (leaseId === lastLeaseId && disposition === lastDisposition) return;
  process.stdout.write(`${JSON.stringify({
    at: new Date().toISOString(),
    lease_id: leaseId,
    farm_status: farm?.status || "idle",
    stop_reason: farm?.stop_reason || null,
    disposition,
  })}\n`);
  lastLeaseId = leaseId;
  lastDisposition = disposition;
}

async function monitorOnce() {
  const farm = await farmStatus({ projectDir, agentId });
  if (farm.active) {
    const nmKills = Number(farm.counters?.notorious_monsters_killed || 0);
    if (stopAfterNmKills > 0 && nmKills >= stopAfterNmKills) {
      logTransition(farm, "stopping_nm_kill_threshold");
      await writeState({
        status: "running",
        disposition: "stopping_nm_kill_threshold",
        farm,
      });
      const stopped = await stopFarm({
        projectDir,
        agentId,
        leaseId: farm.lease_id,
      });
      logTransition(stopped, "stopped_nm_kill_threshold");
      await writeState({
        status: "blocked",
        disposition: "stopped_nm_kill_threshold",
        farm: stopped,
      });
      return;
    }
    logTransition(farm, "healthy");
    await writeState({ status: "running", disposition: "healthy", farm });
    return;
  }

  if (
    farm.status === "stopped"
    && restartableReasons.has(farm.stop_reason)
    && farm.config
  ) {
    logTransition(farm, "renewing");
    await writeState({ status: "running", disposition: "renewing", farm });
    const renewed = await startFarm(configForRenewal(farm));
    renewals += 1;
    logTransition(renewed, "renewed");
    await writeState({
      status: "running",
      disposition: "renewed",
      farm: renewed,
    });
    return;
  }

  const disposition = farm.status === "running"
    ? "blocked_stale_heartbeat"
    : `blocked_${farm.stop_reason || farm.status || "idle"}`;
  logTransition(farm, disposition);
  await writeState({ status: "blocked", disposition, farm });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

while (!stopping) {
  try {
    await monitorOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      at: new Date().toISOString(),
      disposition: "monitor_error",
      error: message,
    })}\n`);
    await writeState({
      status: "blocked",
      disposition: "monitor_error",
      farm: null,
      lastError: message,
    }).catch(() => {});
  }
  if (!stopping) await sleep(intervalSeconds * 1000);
}

const finalFarm = await farmStatus({ projectDir, agentId }).catch(() => null);
await writeState({
  status: "stopped",
  disposition: "signal",
  farm: finalFarm,
});
