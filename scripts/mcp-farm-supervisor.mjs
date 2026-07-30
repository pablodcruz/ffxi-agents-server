#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCheckVerdict } from "../src/check-verdict.mjs";
import {
  canCompleteCooperativeStop,
  canStopAtFightLimit,
  classifyReactiveTiming,
  hasLiveCombat,
  isClosedMenuInputRace,
  isFarmCheckApproved,
  isRecoverableMovementRace,
  latestLineOfSightFailure,
  lineOfSightNudgeDestination,
  nextLevelBandTransition,
  parseCombatRewards,
  playerDefeated,
  readyTrustSupport,
  relocationMaximumLevelOffset,
  safeCombatPosition,
  selectProactiveTarget,
  selectRelocationCamp,
  selectTrustedCampSweepTarget,
  shouldAutoCancelMenu,
  shouldRecoverDroppedEngagement,
  shouldReissueReactiveAttack,
  shouldRetryRecoveryCommand,
  shouldSkipEngagementForCooperativeStop,
  shouldWaitForLevelProgress,
  targetDefeated,
} from "../src/farm-supervisor-policy.mjs";
import {
  playerPartyMember,
  selectReactiveThreat,
} from "../src/reactive-combat-policy.mjs";
import {
  selectQuestDropTarget,
  selectWatchedDropTarget,
} from "../src/quest-drop-policy.mjs";
import { FARM_CONFIRMATION } from "../src/farm-supervisor-manager.mjs";
import { selectReadyJobAbility } from "../src/job-ability-policy.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function integerArgument(name, fallback, minimum, maximum) {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function booleanArgument(name, fallback = false) {
  const value = String(argument(name, String(fallback)));
  if (!["true", "false"].includes(value)) {
    throw new Error(`${name} must be true or false.`);
  }
  return value === "true";
}

function safeLabel(value, name) {
  const label = String(value || "");
  if (!label || label.length > 64 || /["\r\n;|]/.test(label)) {
    throw new Error(`${name} contains unsafe gameplay-command characters.`);
  }
  return label;
}

const agentId = String(argument("--agent-id", "primary"));
const leaseId = String(argument("--lease-id", ""));
const zoneId = integerArgument("--zone-id", 0, 1, 298);
const maximumSeconds = integerArgument("--maximum-seconds", 900, 10, 3600);
const maximumFights = integerArgument("--maximum-fights", 30, 1, 200);
const scanRadius = integerArgument("--scan-radius", 50, 10, 50);
const minimumStartHpPercent = integerArgument(
  "--minimum-start-hp-percent",
  90,
  50,
  100,
);
const allowCaution = booleanArgument("--allow-caution");
const autoRelocate = booleanArgument("--auto-relocate");
const autoTransition = booleanArgument("--auto-transition");
const targetLevel = integerArgument("--target-level", 0, 0, 99);
const questItemId = integerArgument("--quest-item-id", 0, 0, 65534);
const trustedCampSweep = booleanArgument("--trusted-camp-sweep");
const autoJobAbilities = booleanArgument("--auto-job-abilities");
const weaponSkill = safeLabel(argument("--weapon-skill", "Combo"), "--weapon-skill");
const quadavFetichNames = [
  "Amber Quadav",
  "Greater Quadav",
  "Old Quadav",
  "Veteran Quadav",
  "Brass Quadav",
];
const quadavFetichProfile = (label) => ({
  zone_id: 143,
  names: quadavFetichNames,
  preferred_names: ["Brass Quadav"],
  label,
});
const questProfiles = new Map([
  [537, { zone_id: 103, names: ["Damselfly"], label: "Damselfly Worm" }],
  [538, { zone_id: 103, names: ["Ghoul"], label: "Magicked Skull" }],
  [539, { zone_id: 103, names: ["Snipper"], label: "Crab Apron" }],
  [606, quadavFetichProfile("Quadav Fetich Head")],
  [607, quadavFetichProfile("Quadav Fetich Torso")],
  [608, quadavFetichProfile("Quadav Fetich Arms")],
  [609, quadavFetichProfile("Quadav Fetich Legs")],
  [4362, { zone_id: 120, names: ["Hill Lizard"], label: "Lizard Egg" }],
]);
const questProfile = questProfiles.get(questItemId) || null;

if (!/^[A-Za-z0-9_-]{1,32}$/.test(agentId)) {
  throw new Error("--agent-id is invalid.");
}
if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
  throw new Error("--lease-id must be a UUID.");
}
if (argument("--confirmation") !== FARM_CONFIRMATION) {
  throw new Error(`Supervisor requires --confirmation "${FARM_CONFIRMATION}".`);
}
if (questItemId > 0 && !questProfile && !trustedCampSweep) {
  throw new Error(
    "Unknown quest item IDs require --trusted-camp-sweep true so the item is only a stop watcher.",
  );
}
if (questProfile && questProfile.zone_id !== zoneId) {
  throw new Error(`Quest item ${questItemId} requires zone ${questProfile.zone_id}.`);
}
if (questProfile && autoTransition) {
  throw new Error("Quest-item farming cannot automatically transition zones.");
}

const runtimeDir = path.join(projectDir, "runtime", "farm-supervisor");
const statePath = path.join(runtimeDir, `${agentId}.json`);
const stopPath = path.join(runtimeDir, `${leaseId}.stop`);
const metadataDirectory = path.join(projectDir, "runtime", "mob-metadata");
const pollMilliseconds = 200;
const threatDistance = 20;
const cooldownMilliseconds = 30_000;
const relocationIdleMilliseconds = 5_000;
const relocationCooldownMilliseconds = 300_000;
const rewardSettlementMilliseconds = 2_000;
const desiredTrusts = Object.freeze([
  Object.freeze({ observed_name: "Valaineral", spell_name: "Valaineral" }),
  Object.freeze({ observed_name: "Joachim", spell_name: "Joachim" }),
  Object.freeze({
    observed_name: "MihliAliapoh",
    spell_name: "Mihli Aliapoh",
  }),
]);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-farm-supervisor",
  version: "0.1.0",
});

const counters = {
  fights_completed: 0,
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
};
const metrics = {
  aggro_response_samples: 0,
  last_aggro_response_ms: null,
  maximum_aggro_response_ms: null,
  handoff_queue_samples: 0,
  last_handoff_queue_ms: null,
  maximum_handoff_queue_ms: null,
};
const startedAt = Date.now();
const startedAtIso = new Date(startedAt).toISOString();
let phase = "starting";
let status = "starting";
let stopReason = null;
let lastError = null;
let currentTarget = null;
let currentMode = null;
let previousTargetId = null;
let lastEventId = 0;
let lastWeaponSkillAt = 0;
let lastAnyJobAbilityAt = 0;
const lastJobAbilityAt = new Map();
let lastStateWriteAt = 0;
let missingTargetSamples = 0;
let stopping = false;
let cooperativeStopRequestedAt = null;
let cooperativeStopIdleSamples = 0;
let recovering = false;
let activeZoneId = zoneId;
let metadata = [];
let leaseOriginPosition = null;
let noTargetSince = null;
let levelGoalOverlayDirty = targetLevel > 0;
let lastLevelGoalProgressKey = null;
let nextLevelGoalOverlayAttemptAt = 0;
const cooldowns = new Map();
const relocationCooldowns = new Map();
const threatFirstSeen = new Map();

function log(event, details = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    lease_id: leaseId,
    ...details,
  }));
}

async function writeState(force = false) {
  if (!force && Date.now() - lastStateWriteAt < 750) return;
  const state = {
    schema_version: 1,
    agent_id: agentId,
    lease_id: leaseId,
    pid: process.pid,
    status,
    phase,
    started_at: startedAtIso,
    heartbeat_at_ms: Date.now(),
    elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    stop_reason: stopReason,
    last_error: lastError,
    current_target: currentTarget
      ? {
          server_id: currentTarget.server_id,
          name: currentTarget.name,
          mode: currentMode,
        }
      : null,
    config: {
      zone_id: zoneId,
      maximum_seconds: maximumSeconds,
      maximum_fights: maximumFights,
      scan_radius: scanRadius,
      minimum_start_hp_percent: minimumStartHpPercent,
      allow_caution: allowCaution,
      auto_relocate: autoRelocate,
      auto_transition: autoTransition,
      target_level: targetLevel,
      quest_item_id: questItemId,
      trusted_camp_sweep: trustedCampSweep,
      auto_job_abilities: autoJobAbilities,
      weapon_skill: weaponSkill,
    },
    active_zone_id: activeZoneId,
    counters,
    metrics,
  };
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporaryPath, statePath);
  lastStateWriteAt = Date.now();
}

async function transition(nextPhase, details = {}) {
  if (phase !== nextPhase) {
    phase = nextPhase;
    log("phase", { phase, ...details });
  }
  await writeState(true);
}

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function call(name, args = {}) {
  const response = await client.callTool({
    name,
    arguments: { agent_id: agentId, ...args },
  });
  if (response.isError) {
    const detail = response.content?.map((entry) => entry.text).join(" ") || "";
    throw new Error(`${name} failed${detail ? `: ${detail}` : "."}`);
  }
  return valueOf(response);
}

async function armControl() {
  return call("ffxi_enable_control", {
    confirmation: "ENABLE PRIVATE SERVER CONTROL",
  });
}

async function observe() {
  return call("ffxi_observe", {
    radius: scanRadius,
    max_entities: 64,
    event_limit: 30,
  });
}

async function characterState() {
  return call("ffxi_character_state", {
    inventory_container: 0,
    include_recasts: false,
    max_items: questItemId > 0 ? 80 : 1,
  });
}

function questItemCount(state) {
  if (questItemId <= 0) return 0;
  return (state?.inventory?.items || [])
    .filter((item) => Number(item.item_id) === questItemId)
    .reduce((total, item) => total + Number(item.count || 0), 0);
}

async function stopIfQuestItemObtained() {
  if (questItemId <= 0) return false;
  const state = await characterState();
  const count = questItemCount(state);
  if (count <= 0) return false;
  stopReason = "quest_item_obtained";
  stopping = true;
  log("quest_item_obtained", {
    item_id: questItemId,
    item_name: questProfile?.label || `item ${questItemId}`,
    count,
  });
  return true;
}

const mainJobNames = new Map([
  [1, "WARRIOR"],
  [2, "MONK"],
  [3, "WHITE MAGE"],
  [4, "BLACK MAGE"],
  [5, "RED MAGE"],
  [6, "THIEF"],
]);

async function updateLevelGoalOverlay() {
  if (targetLevel <= 0) return null;
  const state = await characterState();
  const player = state?.player;
  const mainJobId = Number(player?.main_job_id);
  const mainJobName = mainJobNames.get(mainJobId) || `JOB ${mainJobId}`;
  const level = Number(player?.main_job_level);
  const currentExp = Number(player?.exp_current);
  const neededExp = Number(player?.exp_needed);
  if (
    state?.login_status !== 2
    || !Number.isInteger(level)
    || !Number.isFinite(currentExp)
    || !Number.isFinite(neededExp)
  ) {
    return null;
  }
  const progressKey = `${mainJobId}:${level}:${currentExp}:${neededExp}`;
  if (progressKey === lastLevelGoalProgressKey) return null;
  const existing = state?.goal_overlay || {};
  const gil = Number(existing.current_gil);
  const targetGil = Number(existing.target_gil);
  await call("ffxi_set_goal_overlay", {
    enabled: true,
    current_gil: Number.isSafeInteger(gil) && gil >= 0 ? gil : 0,
    target_gil: Number.isSafeInteger(targetGil) && targetGil > 0
      ? targetGil
      : 10_000,
    title: `CURRENT GOAL: ${mainJobName} LEVEL ${targetLevel}`,
    progress_label: level >= targetLevel
      ? `LEVEL ${level} REACHED | AUTOMATED LEVELING COMPLETE`
      : `LEVEL ${level} | ${currentExp}/${neededExp} EXP | LOCAL AUTOMATION ACTIVE`,
  });
  log("level_goal_overlay_updated", {
    level,
    exp_current: currentExp,
    exp_needed: neededExp,
    main_job_id: mainJobId,
    main_job_name: mainJobName,
    target_level: targetLevel,
  });
  lastLevelGoalProgressKey = progressKey;
  return { level, reached: level >= targetLevel };
}

function availablePartyNames(observation) {
  return new Set(
    (observation?.party || [])
      .filter((member) => (
        Number(member?.zone_id) === Number(activeZoneId)
        && Number(member?.hp_percent) > 0
      ))
      .map((member) => String(member?.name || "")),
  );
}

function missingDesiredTrusts(observation) {
  const names = availablePartyNames(observation);
  return desiredTrusts.filter(
    (trust) => !names.has(trust.observed_name),
  );
}

async function ensureTrustParty(observation) {
  let current = observation;
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const trust of missingDesiredTrusts(current)) {
      if (
        hasLiveCombat(current)
        || Number(current?.player?.status) !== 0
        || current?.login_status !== 2
      ) {
        return current;
      }
      const uiState = await characterState();
      if (uiState?.menu_open) return current;
      await armControl();
      await command(`/ma "${trust.spell_name}" <me>`);
      let summoned = false;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        current = await sample();
        if (hasLiveCombat(current)) return current;
        if (availablePartyNames(current).has(trust.observed_name)) {
          summoned = true;
          counters.trust_summons += 1;
          log("trust_summoned", {
            name: trust.observed_name,
            zone_id: activeZoneId,
            pass,
          });
          break;
        }
      }
      if (!summoned) {
        log("trust_summon_unavailable", {
          name: trust.observed_name,
          zone_id: activeZoneId,
          pass,
        });
      }
    }
    if (missingDesiredTrusts(current).length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return current;
}

async function waitForMenu(expectedMenu, timeoutMilliseconds = 5000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let uiState = null;
  while (Date.now() < deadline) {
    uiState = await characterState();
    if (
      uiState?.menu_open
      && String(uiState?.menu_name || "").trim() === expectedMenu
    ) {
      return uiState;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const observedMenu = String(uiState?.menu_name || "").trim();
  throw new Error(
    `Expected ${expectedMenu}; observed ${observedMenu || "closed"} after timeout.`,
  );
}

async function command(text) {
  return call("ffxi_gameplay_command", { command: text });
}

function entityById(observation, serverId) {
  return (observation?.nearby_entities || []).find(
    (entity) => Number(entity.server_id) === Number(serverId),
  ) || (
    Number(observation?.target?.server_id) === Number(serverId)
      ? observation.target
      : null
  );
}

function maxObservedEventId(observation) {
  return Math.max(
    lastEventId,
    0,
    ...(observation?.recent_events || []).map((event) => Number(event.id) || 0),
  );
}

function ingestEvents(observation) {
  const playerName = playerPartyMember(observation)?.name
    || observation?.player?.name
    || "";
  const rewards = parseCombatRewards(observation?.recent_events, {
    afterEventId: lastEventId,
    playerName,
  });
  counters.gil_earned += rewards.gil_earned;
  counters.exp_earned += rewards.exp_earned;
  lastEventId = rewards.last_event_id;
}

function observeThreats(observation) {
  const now = Date.now();
  for (const entity of observation?.nearby_entities || []) {
    if (
      Number(entity.status) === 1
      && Number(entity.hp_percent) > 0
      && Number(entity.distance) <= threatDistance
      && Number(entity.server_id) !== Number(currentTarget?.server_id)
    ) {
      if (!threatFirstSeen.has(Number(entity.server_id))) {
        threatFirstSeen.set(Number(entity.server_id), now);
      }
    }
  }
}

async function sample() {
  const observation = await observe();
  ingestEvents(observation);
  observeThreats(observation);
  await writeState();
  return observation;
}

function verifySession(observation) {
  if (observation?.login_status !== 2) {
    stopReason = "not_logged_in";
    return false;
  }
  const partyPlayer = playerPartyMember(observation);
  const observedZoneId = Number(partyPlayer?.zone_id);
  if (observedZoneId !== activeZoneId) {
    stopReason = `zone_changed:${observedZoneId || "unknown"}`;
    return false;
  }
  if (playerDefeated(observation)) {
    counters.deaths += 1;
    stopReason = "player_defeated";
    return false;
  }
  return true;
}

async function latchCooperativeStopRequest() {
  if (cooperativeStopRequestedAt !== null) return true;
  try {
    await fs.access(stopPath);
    stopReason = "stop_requested";
    cooperativeStopRequestedAt = Date.now();
    log("farm_stop_draining", {
      current_target: currentTarget?.server_id || null,
    });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function selectExactTarget(target, maxDistance = scanRadius) {
  await armControl();
  await call("ffxi_clear_target");
  await call("ffxi_target_entity", {
    name: target.name,
    server_id: Number(target.server_id),
    max_distance: maxDistance,
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const observation = await sample();
    if (Number(observation.target?.server_id) === Number(target.server_id)) {
      return observation;
    }
  }
  throw new Error(`Exact target verification failed for ${target.name}.`);
}

async function closeWithTargetFollow(observation, target) {
  let entity = entityById(observation, target.server_id);
  const startedDistance = Number(entity?.distance);
  if (!entity || startedDistance <= 1.25) return observation;

  await command("/follow <t>");
  const deadline = Date.now() + 3000;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      observation = await sample();
      entity = entityById(observation, target.server_id);
      if (!entity || Number(entity.distance) <= 1.25) break;
      const otherThreat = selectReactiveThreat(observation, {
        maxDistance: threatDistance,
        excludedServerIds: [Number(target.server_id)],
      });
      if (otherThreat) break;
    }
  } finally {
    await call("ffxi_stop_movement").catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  observation = await sample();
  entity = entityById(observation, target.server_id);
  const followDistance = Number(entity?.distance);
  if (
    entity
    && followDistance > 1.25
    && followDistance >= startedDistance - 0.25
    && followDistance <= 10
  ) {
    await armControl();
    const movement = await call("ffxi_move_to_entity", {
      server_id: Number(target.server_id),
      name: target.name,
      max_start_distance: 10,
      stop_distance: 1.1,
      timeout_seconds: 3,
      stuck_seconds: 1,
    });
    if (movement?.started) {
      const movementDeadline = Date.now() + 3500;
      try {
        while (Date.now() < movementDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          observation = await sample();
          entity = entityById(observation, target.server_id);
          if (!entity || Number(entity.distance) <= 1.25) break;
        }
      } finally {
        await call("ffxi_stop_movement").catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      observation = await sample();
      log("target_direct_approach", {
        name: target.name,
        server_id: target.server_id,
        started_distance: followDistance,
        finished_distance: entityById(observation, target.server_id)?.distance,
      });
    }
  }
  log("target_follow", {
    name: target.name,
    server_id: target.server_id,
    started_distance: startedDistance,
    finished_distance: entityById(observation, target.server_id)?.distance,
  });
  return observation;
}

async function engage(target, mode, {
  handoff = false,
  attempt = 1,
  observation = null,
} = {}) {
  await transition("engaging", {
    name: target.name,
    server_id: target.server_id,
    mode,
  });
  let targeted = observation;
  if (
    mode !== "reactive"
    || Number(targeted?.target?.server_id) !== Number(target.server_id)
  ) {
    targeted = await selectExactTarget(target, scanRadius);
  } else {
    log("reactive_target_preserved", {
      name: target.name,
      server_id: target.server_id,
    });
  }
  let targetAtAttack = entityById(targeted, target.server_id);
  if (mode === "proactive" && Number(targetAtAttack?.distance) > 3.5) {
    targeted = await positionNear(targetAtAttack, targeted, {
      force: true,
      offset: 2.5,
    });
    if (hasLiveCombat(targeted)) {
      throw new Error("Combat began before proactive attack registration.");
    }
    targeted = await selectExactTarget(target, scanRadius);
    targetAtAttack = entityById(targeted, target.server_id);
  }
  if (mode === "proactive") {
    targeted = await closeWithTargetFollow(targeted, target);
    targetAtAttack = entityById(targeted, target.server_id);
  }
  if (mode === "proactive" && Number(targetAtAttack?.distance) > 3.5) {
    throw new Error(`${target.name} moved outside the melee envelope.`);
  }
  const attackBaselineEventId = maxObservedEventId(targeted);
  if (shouldSkipEngagementForCooperativeStop({
    mode,
    stopRequested: await latchCooperativeStopRequest(),
  })) {
    log("engagement_skipped", {
      mode,
      name: target.name,
      server_id: target.server_id,
      reason: "cooperative_stop_requested",
    });
    await transition("draining_stop");
    return;
  }
  await command("/attack <t>");
  currentTarget = {
    server_id: Number(target.server_id),
    name: target.name,
    start_hp_percent: Number(targetAtAttack?.hp_percent),
    attack_baseline_event_id: attackBaselineEventId,
    attack_issued_at_ms: Date.now(),
    attack_attempts: attempt,
    engagement_counted: false,
    handoff,
    last_los_event_id: attackBaselineEventId,
    last_los_recovery_at_ms: 0,
    los_recovery_attempts: 0,
    last_reengage_attempt_at_ms: 0,
    reengage_attempts: 0,
  };
  currentMode = mode;
  missingTargetSamples = 0;
  let aggroResponseMs = null;
  let handoffQueueMs = null;
  if (mode === "reactive" && attempt === 1) {
    const firstSeen = threatFirstSeen.get(Number(target.server_id));
    if (firstSeen) {
      ({ aggroResponseMs, handoffQueueMs } = classifyReactiveTiming({
        firstSeenAt: firstSeen,
        handoff,
      }));
      if (aggroResponseMs !== null) {
        metrics.aggro_response_samples += 1;
        metrics.last_aggro_response_ms = aggroResponseMs;
        metrics.maximum_aggro_response_ms = Math.max(
          Number(metrics.maximum_aggro_response_ms) || 0,
          aggroResponseMs,
        );
      }
      if (handoffQueueMs !== null) {
        metrics.handoff_queue_samples += 1;
        metrics.last_handoff_queue_ms = handoffQueueMs;
        metrics.maximum_handoff_queue_ms = Math.max(
          Number(metrics.maximum_handoff_queue_ms) || 0,
          handoffQueueMs,
        );
      }
      threatFirstSeen.delete(Number(target.server_id));
    }
  }
  log("attack_issued", {
    mode,
    handoff,
    attempt,
    name: target.name,
    server_id: target.server_id,
    distance: entityById(targeted, target.server_id)?.distance,
    aggro_response_ms: aggroResponseMs,
    handoff_queue_ms: handoffQueueMs,
  });
  await transition("fighting");
  if (mode === "reactive") {
    const closed = await closeWithTargetFollow(targeted, target);
    const closedTarget = entityById(closed, target.server_id);
    if (shouldReissueReactiveAttack({
      observation: closed,
      targetServerId: target.server_id,
    })) {
      currentTarget.attack_baseline_event_id = maxObservedEventId(closed);
      currentTarget.attack_issued_at_ms = Date.now();
      await command("/attack <t>");
      log("reactive_attack_reissued", {
        name: target.name,
        server_id: target.server_id,
        distance: closedTarget?.distance,
      });
    } else {
      log("reactive_attack_registered_during_follow", {
        name: target.name,
        server_id: target.server_id,
        distance: closedTarget?.distance,
      });
    }
  }
}

async function engageReactiveSafely(target, options = {}, context = "reactive") {
  try {
    await engage(target, "reactive", options);
    return true;
  } catch (error) {
    counters.target_cycle_errors += 1;
    log("reactive_engagement_retry", {
      context,
      name: target?.name,
      server_id: target?.server_id,
      error: error instanceof Error ? error.message : String(error),
      tracked_target: currentTarget
        ? {
            name: currentTarget.name,
            server_id: currentTarget.server_id,
            mode: currentMode,
          }
        : null,
    });
    if (!currentTarget) await transition("cooldown");
    await new Promise((resolve) => setTimeout(resolve, 250));
    return false;
  }
}

async function returnToHomePointAfterDeath(observation) {
  if (!playerDefeated(observation)) {
    throw new Error("Death recovery requires an authoritative defeated player state.");
  }
  await transition("returning_to_home_point", {
    defeated_zone_id: playerPartyMember(observation)?.zone_id,
  });

  let uiState = await waitForMenu("menu    dead");

  await armControl();
  await call("ffxi_menu_input", { action: "confirm" });
  uiState = await waitForMenu("menu    comyn");

  // The FFXI confirmation defaults to No. Move exactly once to Yes, prove the
  // same menu is still focused, then confirm.
  await armControl();
  await call("ffxi_menu_input", { action: "left" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  uiState = await characterState();
  if (
    !uiState?.menu_open
    || String(uiState?.menu_name || "").trim() !== "menu    comyn"
  ) {
    throw new Error("Home Point confirmation changed before the Yes selection.");
  }
  await armControl();
  await call("ffxi_menu_input", { action: "confirm" });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const revived = await observe();
    if (
      revived?.login_status === 2
      && !playerDefeated(revived)
      && Number(revived?.player?.hp_percent) > 0
    ) {
      counters.home_point_returns += 1;
      currentTarget = null;
      currentMode = null;
      stopReason = "player_defeated_home_point";
      log("home_point_return_complete", {
        zone_id: playerPartyMember(revived)?.zone_id,
        player_hp_percent: revived.player?.hp_percent,
      });
      return revived;
    }
  }
  throw new Error("Home Point return did not produce a live player within 30 seconds.");
}

async function completeDeathRecovery(observation) {
  try {
    return await returnToHomePointAfterDeath(observation);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    stopReason = "player_defeated_recovery_failed";
    log("home_point_return_failed", { error: lastError });
    return observation;
  }
}

async function recover(observation) {
  if (
    Number(observation?.player?.hp_percent) >= minimumStartHpPercent
    && Number(observation?.player?.status) !== 33
  ) {
    return { observation, threat: null };
  }
  if (hasLiveCombat(observation)) {
    return {
      observation,
      threat: selectReactiveThreat(observation, { maxDistance: threatDistance }),
    };
  }

  await transition("recovering", {
    player_hp_percent: observation?.player?.hp_percent,
  });
  await armControl();
  await command("/heal");
  let lastHealCommandAt = Date.now();
  recovering = true;
  counters.recoveries += 1;
  let recoveryThreat = null;
  try {
    while (Date.now() - startedAt < maximumSeconds * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      observation = await sample();
      if (!verifySession(observation)) break;
      const threat = selectReactiveThreat(observation, {
        maxDistance: threatDistance,
      });
      if (threat || hasLiveCombat(observation)) {
        recoveryThreat = threat;
        break;
      }
      if (shouldRetryRecoveryCommand({
        observation,
        minimumHpPercent: minimumStartHpPercent,
        lastCommandAt: lastHealCommandAt,
      })) {
        await command("/heal");
        lastHealCommandAt = Date.now();
        log("recovery_command_reissued", {
          player_hp_percent: observation?.player?.hp_percent,
        });
        continue;
      }
      if (Number(observation?.player?.hp_percent) >= minimumStartHpPercent) {
        break;
      }
      if (await latchCooperativeStopRequest()) break;
    }
  } finally {
    recovering = false;
    const idleDeadline = Date.now() + 5000;
    let idleSamples = 0;
    let standCommandSent = false;
    while (Date.now() < idleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const standing = await sample().catch(() => null);
      if (!standing) break;
      observation = standing;
      const threat = selectReactiveThreat(standing, {
        maxDistance: threatDistance,
      });
      if (threat || hasLiveCombat(standing)) {
        recoveryThreat = threat;
        break;
      }
      if (Number(standing?.player?.status) === 33) {
        idleSamples = 0;
        if (!standCommandSent) {
          await command("/heal").catch(() => {});
          standCommandSent = true;
        }
        continue;
      }
      if (Number(standing?.player?.status) === 0) {
        idleSamples += 1;
        if (idleSamples >= 2) break;
      } else {
        idleSamples = 0;
      }
    }
  }
  return { observation, threat: recoveryThreat };
}

async function positionNear(target, observation, {
  force = false,
  offset = 2.5,
} = {}) {
  if (!force && Number(target.distance) <= 3.5) return observation;
  const destination = safeCombatPosition({ observation, target, offset });
  if (!destination) return observation;
  await transition("positioning", {
    name: target.name,
    server_id: target.server_id,
    distance: target.distance,
  });
  const before = await sample();
  if (hasLiveCombat(before)) {
    log("combat_position_blocked", {
      server_id: target.server_id,
      reason: "live_combat",
    });
    return before;
  }
  await armControl();
  await call("ffxi_service_teleport", {
    x: destination.x,
    y: destination.y,
    z: destination.z,
    zone_id: activeZoneId,
    reason: "combat_position",
    confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const after = await sample();
  log("combat_position", {
    server_id: target.server_id,
    destination,
    live_combat_after: hasLiveCombat(after),
  });
  return after;
}

async function returnToLeaseOrigin(observation) {
  if (!leaseOriginPosition || hasLiveCombat(observation)) return observation;
  const playerPosition = observation?.player?.position;
  if (!playerPosition) return observation;
  const horizontalDistance = Math.hypot(
    Number(playerPosition.x) - Number(leaseOriginPosition.x),
    Number(playerPosition.y) - Number(leaseOriginPosition.y),
  );
  if (horizontalDistance <= 3.5) return observation;

  await transition("returning_to_camp", {
    distance: horizontalDistance,
  });
  const before = await sample();
  if (hasLiveCombat(before)) {
    log("camp_return_blocked", { reason: "live_combat" });
    return before;
  }
  await armControl();
  await call("ffxi_service_teleport", {
    x: Number(leaseOriginPosition.x),
    y: Number(leaseOriginPosition.y),
    z: Number(leaseOriginPosition.z),
    zone_id: activeZoneId,
    reason: "combat_position",
    confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const after = await sample();
  log("camp_return", {
    destination: leaseOriginPosition,
    live_combat_after: hasLiveCombat(after),
  });
  return after;
}

function excludedRelocationServerIds() {
  const now = Date.now();
  for (const [serverId, expiresAt] of relocationCooldowns) {
    if (expiresAt <= now) relocationCooldowns.delete(serverId);
  }
  return new Set(relocationCooldowns.keys());
}

async function relocateToCamp(camp, observation) {
  if (!camp || hasLiveCombat(observation)) return observation;
  const destination = safeCombatPosition({
    observation,
    target: { position: camp.position },
    offset: 4,
  });
  if (!destination) return observation;

  await transition("relocating_camp", {
    name: camp.name,
    server_id: camp.server_id,
    cluster_size: camp.cluster_size,
    travel_distance: camp.travel_distance,
    nearest_aggro_distance: camp.nearest_aggro_distance,
  });
  const before = await sample();
  if (hasLiveCombat(before)) {
    log("camp_relocation_blocked", { reason: "live_combat" });
    return before;
  }
  await armControl();
  await call("ffxi_service_teleport", {
    x: destination.x,
    y: destination.y,
    z: destination.z,
    zone_id: activeZoneId,
    reason: "combat_position",
    confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
  });
  for (const serverId of camp.cluster_server_ids) {
    relocationCooldowns.set(
      Number(serverId),
      Date.now() + relocationCooldownMilliseconds,
    );
  }
  counters.camp_relocations += 1;
  await new Promise((resolve) => setTimeout(resolve, 800));
  const after = await sample();
  log("camp_relocated", {
    destination,
    cluster_size: camp.cluster_size,
    cluster_server_ids: camp.cluster_server_ids,
    live_combat_after: hasLiveCombat(after),
  });
  return after;
}

async function loadZoneMetadata(nextZoneId) {
  const document = JSON.parse(await fs.readFile(
    path.join(metadataDirectory, `zone-${nextZoneId}.json`),
    "utf8",
  ));
  return document.mobs || [];
}

async function transitionToLevelBand(profile, camp, observation) {
  if (!profile || !camp || hasLiveCombat(observation)) return observation;
  const destination = {
    x: Number(camp.position.x) - 4,
    y: Number(camp.position.y),
    z: Number(camp.position.z),
  };
  await transition("transitioning_zone", {
    from_zone_id: activeZoneId,
    to_zone_id: profile.zone_id,
    reason: profile.reason,
    name: camp.name,
    cluster_size: camp.cluster_size,
    nearest_aggro_distance: camp.nearest_aggro_distance,
  });
  const before = await sample();
  if (hasLiveCombat(before)) {
    log("zone_transition_blocked", { reason: "live_combat" });
    return before;
  }
  await armControl();
  await call("ffxi_service_teleport", {
    ...destination,
    zone_id: profile.zone_id,
    reason: "combat_position",
    confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
  });

  let after = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    after = await observe();
    const observedZoneId = Number(playerPartyMember(after)?.zone_id);
    if (
      after?.login_status === 2
      && observedZoneId === Number(profile.zone_id)
      && after?.player?.position
    ) {
      break;
    }
  }
  if (
    after?.login_status !== 2
    || Number(playerPartyMember(after)?.zone_id) !== Number(profile.zone_id)
  ) {
    throw new Error(`Level-band transition to zone ${profile.zone_id} did not settle.`);
  }

  activeZoneId = Number(profile.zone_id);
  metadata = await loadZoneMetadata(activeZoneId);
  leaseOriginPosition = { ...after.player.position };
  cooldowns.clear();
  relocationCooldowns.clear();
  noTargetSince = null;
  counters.zone_transitions += 1;
  ingestEvents(after);
  observeThreats(after);
  after = await ensureTrustParty(after);
  log("zone_transition_complete", {
    zone_id: activeZoneId,
    destination,
    party_members: (after.party || []).map((member) => member.name),
  });
  await writeState(true);
  return after;
}

async function waitForIdleStance(observation) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const threat = selectReactiveThreat(observation, {
      maxDistance: threatDistance,
    });
    if (threat || Number(observation?.player?.status) !== 1) {
      return { observation, threat };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    observation = await sample();
  }
  return { observation, threat: null };
}

async function checkTarget(target, observation) {
  await transition("checking", {
    name: target.name,
    server_id: target.server_id,
  });
  observation = await selectExactTarget(target, scanRadius);
  const afterEventId = maxObservedEventId(observation);
  await command("/check <t>");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
    observation = await sample();
    const threat = selectReactiveThreat(observation, {
      maxDistance: threatDistance,
    });
    if (threat) return { observation, threat, verdict: null };
    const verdict = parseCheckVerdict(observation.recent_events, { afterEventId });
    if (verdict.verdict !== "unknown") {
      return { observation, threat: null, verdict };
    }
  }
  return {
    observation,
    threat: null,
    verdict: parseCheckVerdict([], { afterEventId }),
  };
}

async function maybeWeaponSkill(observation) {
  if (
    !currentTarget
    || !currentTarget.engagement_counted
    || Date.now() - lastWeaponSkillAt < 5000
    || Number(observation?.target?.server_id) !== Number(currentTarget.server_id)
    || Number(observation?.target?.hp_percent) < 10
    || Number(observation?.target?.hp_percent)
      >= Number(currentTarget.start_hp_percent)
    || Number(playerPartyMember(observation)?.tp) < 1000
  ) {
    return;
  }
  await armControl();
  await command(`/ws "${weaponSkill}" <t>`);
  lastWeaponSkillAt = Date.now();
  counters.weapon_skills += 1;
  log("weapon_skill", {
    name: weaponSkill,
    server_id: currentTarget.server_id,
  });
}

async function maybeJobAbility(observation) {
  if (!autoJobAbilities || !currentTarget?.engagement_counted) return;
  const player = playerPartyMember(observation);
  const entity = entityById(observation, currentTarget.server_id);
  const ability = selectReadyJobAbility({
    mainJobId: player?.main_job,
    mainJobLevel: player?.main_job_level,
    playerHpPercent: player?.hp_percent,
    inCombat: (
      Number(observation?.player?.status) === 1
      && Number(entity?.status) === 1
    ),
    targetHpPercent: entity?.hp_percent,
    lastUsedAt: lastJobAbilityAt,
    lastAnyAbilityAt: lastAnyJobAbilityAt,
  });
  if (!ability) return;

  await armControl();
  await command(`/ja "${ability.name}" <me>`);
  const issuedAt = Date.now();
  lastJobAbilityAt.set(ability.name, issuedAt);
  lastAnyJobAbilityAt = issuedAt;
  counters.job_abilities += 1;
  log("job_ability", {
    name: ability.name,
    main_job_level: player?.main_job_level,
    player_hp_percent: player?.hp_percent,
    server_id: currentTarget.server_id,
  });
}

async function nudgeThroughTarget(observation, target, {
  attempt,
  requireEngaged,
  reason,
  maximumTargetDistance = 4,
}) {
  const destination = lineOfSightNudgeDestination({
    player: observation?.player,
    target,
    requireEngaged,
    maximumTargetDistance,
  });
  if (!destination) return observation;

  await transition("line_of_sight_recovery", {
    name: target.name,
    server_id: target.server_id,
    attempt,
    reason,
    destination,
  });
  await armControl();
  try {
    await call("ffxi_move_to_position", {
      x: destination.x,
      y: destination.y,
      max_start_distance: 6,
      stop_distance: 0.5,
      timeout_seconds: 2,
      stuck_seconds: 1,
    });
  } catch (error) {
    if (!isRecoverableMovementRace(error)) throw error;
    log("line_of_sight_nudge_race", {
      name: target.name,
      server_id: target.server_id,
      attempt,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 1400));
  await call("ffxi_stop_movement").catch(() => {});
  const after = await sample();
  log("line_of_sight_nudge", {
    name: target.name,
    server_id: target.server_id,
    attempt,
    reason,
    player_position: after?.player?.position,
    target_distance: entityById(after, target.server_id)?.distance,
  });
  await transition(requireEngaged ? "fighting" : "positioning");
  return after;
}

function clearExpiredCooldowns() {
  const now = Date.now();
  for (const [serverId, until] of cooldowns) {
    if (until <= now) cooldowns.delete(serverId);
  }
}

function excludedServerIds() {
  clearExpiredCooldowns();
  return new Set(cooldowns.keys());
}

function watchedDropNames() {
  if (questItemId <= 0) return [];
  return [...new Set(
    metadata
      .filter((mob) => (
        Number(mob.mob_type || 0) === 0
        && (mob.drops || []).some((drop) => (
          Number(drop.item_id) === questItemId
          && Number(drop.item_rate) > 0
        ))
      ))
      .map((mob) => String(mob.name)),
  )];
}

function watchedSpawnServerIds() {
  if (questItemId <= 0) return new Set();
  const dropMobs = metadata.filter((mob) => (
    Number(mob.mob_type || 0) === 0
    && (mob.drops || []).some((drop) => (
      Number(drop.item_id) === questItemId
      && Number(drop.item_rate) > 0
    ))
  ));
  const dropSlots = new Set(
    dropMobs
      .map((mob) => Number(mob.spawn_slot_id))
      .filter((slotId) => slotId > 0),
  );
  return new Set(
    metadata
      .filter((mob) => (
        dropMobs.includes(mob)
        || dropSlots.has(Number(mob.spawn_slot_id))
      ))
      .map((mob) => Number(mob.server_id)),
  );
}

async function handleFight(observation) {
  const entity = entityById(observation, currentTarget.server_id);
  if (!entity) missingTargetSamples += 1;
  else missingTargetSamples = 0;
  const defeated = targetDefeated(entity) && (
    entity || missingTargetSamples >= 2
  );
  if (
    !currentTarget.engagement_counted
    && (
      Number(entity?.hp_percent) < Number(currentTarget.start_hp_percent)
      || defeated
      || (
        currentMode === "proactive"
        && Number(entity?.status) === 1
      )
      || (
        currentMode === "reactive"
        && Number(observation?.player?.status) === 1
        && Number(entity?.status) === 1
      )
    )
  ) {
    currentTarget.engagement_counted = true;
    if (currentMode === "reactive") counters.reactive_engagements += 1;
    else counters.proactive_engagements += 1;
    if (currentTarget.handoff) counters.multi_target_handoffs += 1;
    log("engaged", {
      mode: currentMode,
      handoff: currentTarget.handoff,
      name: currentTarget.name,
      server_id: currentTarget.server_id,
    });
  }

  if (currentTarget.engagement_counted) {
    if (
      shouldRecoverDroppedEngagement({
        observation,
        target: entity,
        lastAttemptAt: currentTarget.last_reengage_attempt_at_ms,
      })
    ) {
      currentTarget.last_reengage_attempt_at_ms = Date.now();
      currentTarget.reengage_attempts += 1;
      try {
        const retargeted = await selectExactTarget(entity, threatDistance);
        currentTarget.attack_baseline_event_id = maxObservedEventId(retargeted);
        currentTarget.attack_issued_at_ms = Date.now();
        await command("/attack <t>");
        log("engagement_reissued", {
          mode: currentMode,
          name: currentTarget.name,
          server_id: currentTarget.server_id,
          distance: entity.distance,
          attempt: currentTarget.reengage_attempts,
          reason: "player_dropped_to_idle",
        });
      } catch (error) {
        log("engagement_reissue_race", {
          mode: currentMode,
          name: currentTarget.name,
          server_id: currentTarget.server_id,
          attempt: currentTarget.reengage_attempts,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
      return;
    }
    const lineOfSightFailure = latestLineOfSightFailure(
      observation.recent_events,
      { afterEventId: currentTarget.last_los_event_id },
    );
    if (lineOfSightFailure) {
      currentTarget.last_los_event_id = Number(lineOfSightFailure.id);
      const outOfRange = /out of range\b/i.test(
        String(lineOfSightFailure.message || "")
          .replace(/[^\x20-\x7e]+/g, " ")
          .trim(),
      );
      if (
        Number(currentTarget.los_recovery_attempts) < 3
        && Date.now() - Number(currentTarget.last_los_recovery_at_ms) >= 3000
      ) {
        currentTarget.los_recovery_attempts += 1;
        currentTarget.last_los_recovery_at_ms = Date.now();
        await nudgeThroughTarget(observation, entity, {
          attempt: currentTarget.los_recovery_attempts,
          requireEngaged: true,
          reason: outOfRange
            ? "engaged_out_of_range"
            : "engaged_visibility_failure",
          maximumTargetDistance: outOfRange ? 6 : 4,
        });
        return;
      }
    }
  }

  const rejectionEvent = observation.recent_events?.find((event) => (
    Number(event.id) > Number(currentTarget.attack_baseline_event_id)
    && Number(event.mode) === 122
    && /^Unable to (?:see|attack)\b/i.test(
      String(event.message || "").replace(/[^\x20-\x7e]+/g, " ").trim(),
    )
  ));
  const registrationTimedOut = (
    !currentTarget.engagement_counted
    && Date.now() - Number(currentTarget.attack_issued_at_ms) >= 6000
  );
  if (
    !currentTarget.engagement_counted
    && (rejectionEvent || registrationTimedOut)
  ) {
    const rejectedTarget = { ...currentTarget };
    const rejectedMode = currentMode;
    counters.attack_rejections += 1;
    log("attack_rejected", {
      mode: rejectedMode,
      name: rejectedTarget.name,
      server_id: rejectedTarget.server_id,
      attempt: rejectedTarget.attack_attempts,
      message: rejectionEvent?.message || "registration_timeout",
    });
    const reactiveDefenseActive = (
      rejectedMode === "reactive"
      && Number(entity?.status) === 1
      && Number(entity?.hp_percent) > 0
    );
    if (!reactiveDefenseActive) {
      await command("/attackoff").catch(() => {});
    }
    currentTarget = null;
    currentMode = null;
    await new Promise((resolve) => setTimeout(resolve, 300));
    let retryObservation = await sample();
    const settled = await waitForIdleStance(retryObservation);
    retryObservation = settled.observation;
    const defensiveThreat = settled.threat;
    if (defensiveThreat) {
      await engageReactiveSafely(defensiveThreat, {
        handoff: rejectedTarget.handoff,
        attempt: Number(rejectedTarget.attack_attempts) + 1,
        observation: retryObservation,
      }, "attack_rejection_defense");
      return;
    }
    const retryTarget = entityById(retryObservation, rejectedTarget.server_id);
    if (
      rejectedMode === "proactive"
      && Number(rejectedTarget.attack_attempts) < 2
      && retryTarget
      && !hasLiveCombat(retryObservation)
    ) {
      try {
        if (
          rejectionEvent
          && latestLineOfSightFailure([rejectionEvent])
        ) {
          retryObservation = await nudgeThroughTarget(
            retryObservation,
            retryTarget,
            {
              attempt: Number(rejectedTarget.attack_attempts),
              requireEngaged: false,
              reason: "proactive_visibility_failure",
            },
          );
        } else {
          retryObservation = await positionNear(retryTarget, retryObservation, {
            force: true,
            offset: 2,
          });
        }
        if (!hasLiveCombat(retryObservation)) {
          await engage(retryTarget, "proactive", {
            handoff: rejectedTarget.handoff,
            attempt: Number(rejectedTarget.attack_attempts) + 1,
          });
          return;
        }
      } catch (error) {
        if (currentTarget) throw error;
        counters.target_cycle_errors += 1;
        log("target_cycle_error", {
          name: rejectedTarget.name,
          server_id: rejectedTarget.server_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    cooldowns.set(
      Number(rejectedTarget.server_id),
      Date.now() + cooldownMilliseconds,
    );
    await transition("cooldown");
    return;
  }

  if (defeated) {
    const defeatedTarget = currentTarget;
    counters.fights_completed += 1;
    previousTargetId = defeatedTarget.server_id;
    currentTarget = null;
    currentMode = null;
    missingTargetSamples = 0;
    log("fight_complete", {
      fight: counters.fights_completed,
      name: defeatedTarget.name,
      server_id: defeatedTarget.server_id,
      player_hp_percent: observation.player?.hp_percent,
    });
    const nextThreat = selectReactiveThreat(observation, {
      maxDistance: threatDistance,
      excludedServerIds: [previousTargetId],
    });
    if (nextThreat) {
      await engageReactiveSafely(nextThreat, {
        handoff: true,
        observation,
      }, "post_fight_handoff");
      return;
    }
    levelGoalOverlayDirty = targetLevel > 0;
    nextLevelGoalOverlayAttemptAt = Math.max(
      nextLevelGoalOverlayAttemptAt,
      Date.now() + rewardSettlementMilliseconds,
    );
    await transition("cooldown");
    await new Promise((resolve) => setTimeout(resolve, 750));
    return;
  }

  const threat = selectReactiveThreat(observation, {
    maxDistance: threatDistance,
  });
  if (
    threat
    && Number(threat.server_id) !== Number(currentTarget.server_id)
    && Number(entity?.status) !== 1
  ) {
    previousTargetId = currentTarget.server_id;
    await engageReactiveSafely(threat, {
      handoff: true,
      observation,
    }, "tracked_fight_handoff");
    return;
  }
  await maybeJobAbility(observation);
  await maybeWeaponSkill(observation);
  await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    stopReason = signal.toLowerCase();
  });
}

try {
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  metadata = await loadZoneMetadata(activeZoneId);
  await client.connect(transport);
  await armControl();
  status = "running";
  await transition("scouting", { metadata_mobs: metadata.length });
  log("farm_supervisor_armed", {
    agent_id: agentId,
    zone_id: zoneId,
    maximum_seconds: maximumSeconds,
    maximum_fights: maximumFights,
    scan_radius: scanRadius,
    allow_caution: allowCaution,
    auto_relocate: autoRelocate,
    auto_transition: autoTransition,
    target_level: targetLevel,
    quest_item_id: questItemId,
    trusted_camp_sweep: trustedCampSweep,
    auto_job_abilities: autoJobAbilities,
  });

  let observation = await observe();
  lastEventId = maxObservedEventId(observation);
  observation = await ensureTrustParty(observation);
  leaseOriginPosition = observation?.player?.position
    ? { ...observation.player.position }
    : null;
  observeThreats(observation);
  await writeState();
  while (!stopping) {
    if (Date.now() - startedAt >= maximumSeconds * 1000) {
      stopReason = "time_limit";
      break;
    }
    await latchCooperativeStopRequest();

    observation = await sample();
    if (!verifySession(observation)) {
      if (stopReason === "player_defeated") {
        await completeDeathRecovery(observation);
      }
      break;
    }

    if (currentTarget) {
      await handleFight(observation);
      continue;
    }

    const reactiveThreat = selectReactiveThreat(observation, {
      maxDistance: threatDistance,
    });
    const uiState = await characterState();
    if (uiState?.menu_open) {
      const menuName = String(uiState.menu_name || "").trim();
      if (shouldAutoCancelMenu({ menuName, reactiveThreat })) {
        await armControl();
        const freshUiState = await characterState();
        if (!freshUiState?.menu_open) {
          log("menu_cancel_skipped", {
            menu_name: menuName || "unknown",
            reason: "menu_closed_before_cancel",
          });
          continue;
        }
        try {
          await call("ffxi_menu_input", { action: "cancel" });
        } catch (error) {
          if (!isClosedMenuInputRace(error)) throw error;
          log("menu_cancel_skipped", {
            menu_name: menuName || "unknown",
            reason: "menu_closed_during_cancel",
          });
          continue;
        }
        log("menu_cancelled", {
          menu_name: menuName || "unknown",
          reason: reactiveThreat ? "reactive_defense" : "known_disposable_menu",
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      stopReason = `menu_open:${menuName || "unknown"}`;
      log("farm_supervisor_blocked", { reason: stopReason });
      break;
    }
    if (reactiveThreat) {
      await engageReactiveSafely(reactiveThreat, {
        handoff: previousTargetId !== null,
        observation,
      }, "idle_reactive_defense");
      continue;
    }
    if (await stopIfQuestItemObtained()) break;
    if (shouldWaitForLevelProgress({
      dirty: levelGoalOverlayDirty,
      now: Date.now(),
      nextAttemptAt: nextLevelGoalOverlayAttemptAt,
    })) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    if (
      levelGoalOverlayDirty
      && Date.now() >= nextLevelGoalOverlayAttemptAt
    ) {
      const levelGoal = await updateLevelGoalOverlay().catch((error) => {
        log("level_goal_overlay_error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      nextLevelGoalOverlayAttemptAt = Date.now() + 500;
      if (levelGoal) levelGoalOverlayDirty = false;
      if (levelGoal?.reached) {
        stopReason = "target_level";
        stopping = true;
        log("target_level_reached", {
          level: levelGoal.level,
          target_level: targetLevel,
        });
        break;
      }
    }
    if (cooperativeStopRequestedAt !== null) {
      cooperativeStopIdleSamples = (
        !currentTarget
        && !reactiveThreat
        && !hasLiveCombat(observation)
        && Number(observation?.player?.status) === 0
      )
        ? cooperativeStopIdleSamples + 1
        : 0;
      if (canCompleteCooperativeStop({
        stopRequested: true,
        observation,
        currentTarget,
        reactiveThreat,
        idleSamples: cooperativeStopIdleSamples,
      })) {
        log("farm_stop_idle_verified", {
          idle_samples: cooperativeStopIdleSamples,
          drain_ms: Date.now() - cooperativeStopRequestedAt,
        });
        break;
      }
      await transition("draining_stop", {
        idle_samples: cooperativeStopIdleSamples,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    if (counters.fights_completed >= maximumFights) {
      observation = await returnToLeaseOrigin(observation);
      const remainingThreat = selectReactiveThreat(observation, {
        maxDistance: threatDistance,
      });
      if (remainingThreat) {
        await engageReactiveSafely(remainingThreat, {
          handoff: true,
          observation,
        }, "fight_limit_drain");
        continue;
      }
      if (canStopAtFightLimit({
        fightsCompleted: counters.fights_completed,
        maximumFights,
        observation,
        currentTarget,
        reactiveThreat: remainingThreat,
      })) {
        stopReason = "fight_limit";
        break;
      }
      await transition("draining");
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    const recovery = await recover(observation);
    observation = recovery.observation;
    if (stopReason === "player_defeated") {
      await completeDeathRecovery(observation);
      break;
    }
    if (stopReason) break;
    if (recovery.threat) {
      await engageReactiveSafely(recovery.threat, {
        handoff: previousTargetId !== null,
        observation,
      }, "recovery_handoff");
      continue;
    }
    if (Number(observation?.player?.status) !== 0) {
      await transition("settling", {
        player_status: observation?.player?.status,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    const missingTrusts = missingDesiredTrusts(observation);
    if (missingTrusts.length > 0) {
      await transition("repairing_trusts", {
        missing: missingTrusts.map((trust) => trust.observed_name),
      });
      observation = await ensureTrustParty(observation);
      if (hasLiveCombat(observation)) continue;
      const stillMissing = missingDesiredTrusts(observation);
      if (stillMissing.length > 0) {
        log("trust_repair_waiting", {
          missing: stillMissing.map((trust) => trust.observed_name),
          player_level: playerPartyMember(observation)?.main_job_level,
        });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
    }

    const partyPlayer = playerPartyMember(observation);
    const levelBandProfile = nextLevelBandTransition({
      autoTransition,
      activeZoneId,
      playerLevel: partyPlayer?.main_job_level,
      targetLevel: targetLevel || 20,
    });
    if (levelBandProfile) {
      const nextMetadata = await loadZoneMetadata(levelBandProfile.zone_id);
      const camp = selectRelocationCamp({
        metadata: nextMetadata,
        playerLevel: Number(partyPlayer?.main_job_level),
        zoneId: levelBandProfile.zone_id,
        currentPosition: null,
        allowedNames: levelBandProfile.allowed_names,
        excludedServerIds: new Set(),
        clusterRadius: scanRadius,
        maximumLevelOffset: Number(
          levelBandProfile.maximum_level_offset ?? 0,
        ),
      });
      if (camp) {
        observation = await transitionToLevelBand(
          levelBandProfile,
          camp,
          observation,
        );
        continue;
      }
    }

    await transition("scouting");
    const preferredDropTarget = trustedCampSweep && questItemId > 0
      ? selectWatchedDropTarget({
          observation,
          metadata,
          itemId: questItemId,
          playerLevel: Number(partyPlayer?.main_job_level),
          radius: scanRadius,
          excludedServerIds: excludedServerIds(),
          maximumLevelOffset: 1,
        })
      : null;
    const target = trustedCampSweep
      ? preferredDropTarget || selectTrustedCampSweepTarget({
          observation,
          metadata,
          playerLevel: Number(partyPlayer?.main_job_level),
          radius: scanRadius,
          excludedServerIds: excludedServerIds(),
        })
      : questProfile
        ? selectQuestDropTarget({
          observation,
          metadata,
          itemId: questItemId,
          allowedNames: questProfile.names,
          preferredNames: questProfile.preferred_names,
          playerLevel: Number(partyPlayer?.main_job_level),
          radius: scanRadius,
          excludedServerIds: excludedServerIds(),
        })
        : selectProactiveTarget({
          observation,
          metadata,
          playerLevel: Number(partyPlayer?.main_job_level),
          zoneId: activeZoneId,
          radius: scanRadius,
          excludedServerIds: excludedServerIds(),
        });
    if (!target) {
      noTargetSince ??= Date.now();
      if (
        autoRelocate
        && Date.now() - noTargetSince >= relocationIdleMilliseconds
      ) {
        const playerLevel = Number(partyPlayer?.main_job_level);
        const camp = selectRelocationCamp({
          metadata,
          playerLevel,
          zoneId: activeZoneId,
          currentPosition: observation?.player?.position,
          allowedServerIds: questItemId > 0
            ? watchedSpawnServerIds()
            : null,
          allowedNames: questItemId > 0
            ? null
            : (trustedCampSweep ? null : questProfile?.names),
          excludedServerIds: excludedRelocationServerIds(),
          clusterRadius: scanRadius,
          minimumAggroDistance: questItemId > 0 ? 0 : 40,
          allowAggressiveCandidates: questItemId > 0,
          minimumLevelOffset: questItemId > 0 ? 99 : 3,
          maximumLevelOffset: trustedCampSweep
            ? 1
            : relocationMaximumLevelOffset({
                zoneId: activeZoneId,
                playerLevel,
              }),
        });
        if (camp) {
          observation = await relocateToCamp(camp, observation);
          noTargetSince = null;
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    noTargetSince = null;

    try {
      observation = await positionNear(target, observation);
      if (!verifySession(observation)) {
        if (stopReason === "player_defeated") {
          await completeDeathRecovery(observation);
        }
        break;
      }
      const positionThreat = selectReactiveThreat(observation, {
        maxDistance: threatDistance,
      });
      if (positionThreat) {
        await engageReactiveSafely(positionThreat, {
          handoff: previousTargetId !== null,
          observation,
        }, "positioning_handoff");
        continue;
      }
      const positionedTarget = entityById(observation, target.server_id);
      if (!positionedTarget || Number(positionedTarget.hp_percent) <= 0) {
        cooldowns.set(Number(target.server_id), Date.now() + 5000);
        continue;
      }

      const checked = trustedCampSweep
        ? {
            observation: await selectExactTarget(target, scanRadius),
            threat: null,
            verdict: {
              verdict: "trusted_camp",
              difficulty: "metadata_admitted",
            },
          }
        : await checkTarget(target, observation);
      observation = checked.observation;
      if (checked.threat) {
        await engageReactiveSafely(checked.threat, {
          handoff: previousTargetId !== null,
          observation,
        }, "check_handoff");
        continue;
      }
      const trustSupport = readyTrustSupport({
        party: observation.party,
        playerName: observation.player?.name,
        zoneId: activeZoneId,
      });
      if (trustedCampSweep && !trustSupport.ready) {
        stopReason = "trusted_camp_support_unavailable";
        stopping = true;
        log("farm_supervisor_blocked", {
          reason: stopReason,
          available_support: trustSupport.members,
        });
        break;
      }
      if (!trustedCampSweep && !isFarmCheckApproved({
        checkVerdict: checked.verdict,
        allowCaution,
        trustedSupportReady: trustSupport.ready,
      })) {
        cooldowns.set(Number(target.server_id), Date.now() + cooldownMilliseconds);
        counters.excluded_pulls += 1;
        log("target_excluded", {
          name: target.name,
          server_id: target.server_id,
          verdict: checked.verdict?.verdict || "unknown",
          difficulty: checked.verdict?.difficulty || "unknown",
        });
        await transition("cooldown");
        continue;
      }
      if (!trustedCampSweep && checked.verdict?.verdict === "caution") {
        log("target_caution_approved", {
          name: target.name,
          server_id: target.server_id,
          difficulty: checked.verdict.difficulty,
          high_defense: Boolean(checked.verdict.high_defense),
          trusted_support: trustSupport.members,
        });
      }

      const checkedEntity = entityById(observation, target.server_id);
      if (!checkedEntity || Number(checkedEntity.distance) > 8) {
        cooldowns.set(Number(target.server_id), Date.now() + 5000);
        continue;
      }
      await engage(target, "proactive");
    } catch (error) {
      if (currentTarget) throw error;
      counters.target_cycle_errors += 1;
      cooldowns.set(Number(target.server_id), Date.now() + cooldownMilliseconds);
      log("target_cycle_error", {
        name: target.name,
        server_id: target.server_id,
        error: error instanceof Error ? error.message : String(error),
      });
      await transition("cooldown");
    }
  }
} catch (error) {
  status = "error";
  lastError = error instanceof Error ? error.message : String(error);
  stopReason ||= "error";
  log("farm_supervisor_error", { error: lastError });
  process.exitCode = 1;
} finally {
  if (status !== "error") status = "stopping";
  phase = "stopping";
  await writeState(true).catch(() => {});
  if (recovering) await command("/heal").catch(() => {});
  await command("/attackoff").catch(() => {});
  await updateLevelGoalOverlay().catch((error) => {
    log("level_goal_overlay_error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: { agent_id: agentId },
  }).catch(() => {});
  await client.close().catch(() => {});
  if (status !== "error") status = "stopped";
  phase = status === "error" ? "error" : "stopped";
  stopReason ||= "lease_complete";
  await writeState(true).catch(() => {});
  await fs.unlink(stopPath).catch(() => {});
  log("farm_supervisor_stopped", {
    status,
    reason: stopReason,
    counters,
    metrics,
  });
}
