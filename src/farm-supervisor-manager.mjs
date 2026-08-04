import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const FARM_CONFIRMATION = "ARM PRIVATE SERVER FARM SUPERVISOR";

const agentPattern = /^[A-Za-z0-9_-]{1,32}$/;

function pathsFor(projectDir, agentId) {
  const directory = path.join(projectDir, "runtime", "farm-supervisor");
  return {
    directory,
    state: path.join(directory, `${agentId}.json`),
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function publicState(state) {
  if (!state) {
    return {
      status: "idle",
      active: false,
    };
  }
  const heartbeatAgeMs = Date.now() - Number(state.heartbeat_at_ms || 0);
  const active = ["starting", "running", "stopping"].includes(state.status)
    && heartbeatAgeMs <= 5000;
  return {
    ...state,
    active,
    heartbeat_age_ms: heartbeatAgeMs,
    pid: undefined,
  };
}

export async function farmStatus({ projectDir, agentId = "primary" }) {
  if (!agentPattern.test(agentId)) throw new Error("Invalid agent id.");
  const paths = pathsFor(projectDir, agentId);
  return publicState(await readJson(paths.state));
}

export function farmRenewalConfig({ projectDir, agentId = "primary", farm }) {
  const config = farm?.config;
  if (!config) throw new Error("Cannot renew a farm lease without persisted config.");
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
    minimumStartMpPercent: config.minimum_start_mp_percent ?? 0,
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
    combatSpellUpgrade: config.combat_spell_upgrade ?? "",
    combatSpellUpgradeLevel: config.combat_spell_upgrade_level ?? 0,
    maximumCombatSpellsPerFight: config.maximum_combat_spells_per_fight,
    minimumCastMpPercent: config.minimum_cast_mp_percent,
    openingCombatSpell: config.opening_combat_spell ?? "",
    minimumOpeningSpellMpPercent:
      config.minimum_opening_spell_mp_percent ?? 65,
    selfBuffSpell: config.self_buff_spell ?? "",
    selfBuffIntervalSeconds: config.self_buff_interval_seconds ?? 150,
    nmRoute: config.nm_route,
    maximumRouteRounds: config.maximum_route_rounds,
    minimumFreeInventorySlots: config.minimum_free_inventory_slots,
    objectiveTargetName: config.objective_target_name ?? "",
    objectiveSupportTargetName: config.objective_support_target_name ?? "",
    objectiveKillCount: config.objective_kill_count ?? 0,
    confirmation: FARM_CONFIRMATION,
  };
}

export function farmSupervisorArgs({
  projectDir,
  agentId,
  leaseId,
  zoneId,
  maximumSeconds,
  maximumFights,
  scanRadius,
  minimumStartHpPercent,
  minimumStartMpPercent = 0,
  allowCaution,
  autoRelocate,
  autoTransition,
  targetLevel,
  questItemId,
  trustedCampSweep,
  maximumTargetLevelOffset,
  autoJobAbilities,
  summonTrusts,
  weaponSkill,
  combatSpell,
  combatSpellUpgrade = "",
  combatSpellUpgradeLevel = 0,
  maximumCombatSpellsPerFight,
  minimumCastMpPercent,
  openingCombatSpell = "",
  minimumOpeningSpellMpPercent = 65,
  selfBuffSpell = "",
  selfBuffIntervalSeconds = 150,
  nmRoute,
  maximumRouteRounds,
  minimumFreeInventorySlots,
  objectiveTargetName = "",
  objectiveSupportTargetName = "",
  objectiveKillCount = 0,
}) {
  return [
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "--agent-id", agentId,
    "--lease-id", leaseId,
    "--zone-id", String(zoneId),
    "--maximum-seconds", String(maximumSeconds),
    "--maximum-fights", String(maximumFights),
    "--scan-radius", String(scanRadius),
    "--minimum-start-hp-percent", String(minimumStartHpPercent),
    "--minimum-start-mp-percent", String(minimumStartMpPercent),
    "--allow-caution", String(Boolean(allowCaution)),
    "--auto-relocate", String(Boolean(autoRelocate)),
    "--auto-transition", String(Boolean(autoTransition)),
    "--target-level", String(targetLevel),
    "--quest-item-id", String(questItemId),
    "--trusted-camp-sweep", String(Boolean(trustedCampSweep)),
    "--maximum-target-level-offset", String(maximumTargetLevelOffset),
    "--auto-job-abilities", String(Boolean(autoJobAbilities)),
    "--summon-trusts", String(Boolean(summonTrusts)),
    "--weapon-skill", weaponSkill,
    "--combat-spell", combatSpell,
    "--combat-spell-upgrade", combatSpellUpgrade,
    "--combat-spell-upgrade-level", String(combatSpellUpgradeLevel),
    "--maximum-combat-spells-per-fight", String(maximumCombatSpellsPerFight),
    "--minimum-cast-mp-percent", String(minimumCastMpPercent),
    "--opening-combat-spell", openingCombatSpell,
    "--minimum-opening-spell-mp-percent", String(minimumOpeningSpellMpPercent),
    "--self-buff-spell", selfBuffSpell,
    "--self-buff-interval-seconds", String(selfBuffIntervalSeconds),
    "--nm-route", String(Boolean(nmRoute)),
    "--maximum-route-rounds", String(maximumRouteRounds),
    "--minimum-free-inventory-slots", String(minimumFreeInventorySlots),
    "--objective-target-name", objectiveTargetName,
    "--objective-support-target-name", objectiveSupportTargetName,
    "--objective-kill-count", String(objectiveKillCount),
    "--confirmation", FARM_CONFIRMATION,
  ];
}

export async function startFarm({
  projectDir,
  agentId = "primary",
  zoneId,
  maximumSeconds = 900,
  maximumFights = 30,
  scanRadius = 50,
  minimumStartHpPercent = 90,
  minimumStartMpPercent = 0,
  allowCaution = false,
  autoRelocate = false,
  autoTransition = false,
  targetLevel = 0,
  questItemId = 0,
  trustedCampSweep = false,
  maximumTargetLevelOffset = 1,
  autoJobAbilities = false,
  summonTrusts = true,
  weaponSkill = "Combo",
  combatSpell = "",
  combatSpellUpgrade = "",
  combatSpellUpgradeLevel = 0,
  maximumCombatSpellsPerFight = 0,
  minimumCastMpPercent = 35,
  openingCombatSpell = "",
  minimumOpeningSpellMpPercent = 65,
  selfBuffSpell = "",
  selfBuffIntervalSeconds = 150,
  nmRoute = false,
  maximumRouteRounds = 1,
  minimumFreeInventorySlots = 5,
  objectiveTargetName = "",
  objectiveSupportTargetName = "",
  objectiveKillCount = 0,
  confirmation,
}) {
  if (confirmation !== FARM_CONFIRMATION) {
    throw new Error(`Farm start requires confirmation: ${FARM_CONFIRMATION}`);
  }
  if (!agentPattern.test(agentId)) throw new Error("Invalid agent id.");
  const current = await farmStatus({ projectDir, agentId });
  if (current.active) {
    throw new Error(`Farm lease ${current.lease_id} is already active.`);
  }

  const leaseId = randomUUID();
  const paths = pathsFor(projectDir, agentId);
  await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await fs.chmod(paths.directory, 0o700);
  const logPath = path.join(paths.directory, `${leaseId}.log`);
  const logHandle = await fs.open(logPath, "a", 0o600);
  const initial = {
    schema_version: 1,
    agent_id: agentId,
    lease_id: leaseId,
    pid: null,
    status: "starting",
    phase: "starting",
    started_at: new Date().toISOString(),
    heartbeat_at_ms: Date.now(),
    log_path: logPath,
    config: {
      zone_id: zoneId,
      maximum_seconds: maximumSeconds,
      maximum_fights: maximumFights,
      scan_radius: scanRadius,
      minimum_start_hp_percent: minimumStartHpPercent,
      minimum_start_mp_percent: minimumStartMpPercent,
      allow_caution: Boolean(allowCaution),
      auto_relocate: Boolean(autoRelocate),
      auto_transition: Boolean(autoTransition),
      target_level: targetLevel,
      quest_item_id: questItemId,
      trusted_camp_sweep: Boolean(trustedCampSweep),
      maximum_target_level_offset: maximumTargetLevelOffset,
      auto_job_abilities: Boolean(autoJobAbilities),
      summon_trusts: Boolean(summonTrusts),
      weapon_skill: weaponSkill,
      combat_spell: combatSpell,
      combat_spell_upgrade: combatSpellUpgrade,
      combat_spell_upgrade_level: combatSpellUpgradeLevel,
      maximum_combat_spells_per_fight: maximumCombatSpellsPerFight,
      minimum_cast_mp_percent: minimumCastMpPercent,
      opening_combat_spell: openingCombatSpell,
      minimum_opening_spell_mp_percent: minimumOpeningSpellMpPercent,
      self_buff_spell: selfBuffSpell,
      self_buff_interval_seconds: selfBuffIntervalSeconds,
      nm_route: Boolean(nmRoute),
      maximum_route_rounds: maximumRouteRounds,
      minimum_free_inventory_slots: minimumFreeInventorySlots,
      objective_target_name: objectiveTargetName,
      objective_support_target_name: objectiveSupportTargetName,
      objective_kill_count: objectiveKillCount,
    },
    counters: {
      fights_completed: 0,
      objective_kills: 0,
      proactive_engagements: 0,
      reactive_engagements: 0,
      multi_target_handoffs: 0,
      weapon_skills: 0,
      recoveries: 0,
      deaths: 0,
      home_point_returns: 0,
      gil_earned: 0,
      exp_earned: 0,
      excluded_pulls: 0,
      attack_rejections: 0,
      target_cycle_errors: 0,
      teleport_while_engaged: 0,
      recovery_while_engaged: 0,
      camp_relocations: 0,
      zone_transitions: 0,
      trust_summons: 0,
      trust_refreshes: 0,
      job_abilities: 0,
      combat_spells: 0,
      self_buffs: 0,
      nm_camps_completed: 0,
      nm_rounds_completed: 0,
      nm_placeholders_killed: 0,
      notorious_monsters_killed: 0,
      nm_sweeps: 0,
      objective_kills: 0,
    },
  };
  await fs.writeFile(paths.state, `${JSON.stringify(initial, null, 2)}\n`, {
    mode: 0o600,
  });

  const args = farmSupervisorArgs({
    projectDir,
    agentId,
    leaseId,
    zoneId,
    maximumSeconds,
    maximumFights,
    scanRadius,
    minimumStartHpPercent,
    minimumStartMpPercent,
    allowCaution,
    autoRelocate,
    autoTransition,
    targetLevel,
    questItemId,
    trustedCampSweep,
    maximumTargetLevelOffset,
    autoJobAbilities,
    summonTrusts,
    weaponSkill,
    combatSpell,
    combatSpellUpgrade,
    combatSpellUpgradeLevel,
    maximumCombatSpellsPerFight,
    minimumCastMpPercent,
    openingCombatSpell,
    minimumOpeningSpellMpPercent,
    selfBuffSpell,
    selfBuffIntervalSeconds,
    nmRoute,
    maximumRouteRounds,
    minimumFreeInventorySlots,
    objectiveTargetName,
    objectiveSupportTargetName,
    objectiveKillCount,
  });
  const child = spawn(process.execPath, args, {
    cwd: projectDir,
    env: process.env,
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });
  child.unref();
  await logHandle.close();

  const stateAfterSpawn = await readJson(paths.state);
  if (
    stateAfterSpawn?.lease_id === leaseId
    && stateAfterSpawn?.status === "starting"
  ) {
    await fs.writeFile(paths.state, `${JSON.stringify({
      ...stateAfterSpawn,
      pid: child.pid,
      heartbeat_at_ms: Date.now(),
    }, null, 2)}\n`, { mode: 0o600 });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await farmStatus({ projectDir, agentId });
    if (status.lease_id === leaseId && status.status !== "starting") return status;
  }
  return farmStatus({ projectDir, agentId });
}

export async function stopFarm({
  projectDir,
  agentId = "primary",
  leaseId,
}) {
  if (!agentPattern.test(agentId)) throw new Error("Invalid agent id.");
  const current = await farmStatus({ projectDir, agentId });
  if (!current.active) return current;
  if (leaseId && current.lease_id !== leaseId) {
    throw new Error("Farm stop lease id does not match the active lease.");
  }
  const paths = pathsFor(projectDir, agentId);
  const stopPath = path.join(paths.directory, `${current.lease_id}.stop`);
  await fs.writeFile(stopPath, `${new Date().toISOString()}\n`, { mode: 0o600 });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await farmStatus({ projectDir, agentId });
    if (!status.active) return status;
  }
  return {
    ...(await farmStatus({ projectDir, agentId })),
    stop_requested: true,
  };
}
