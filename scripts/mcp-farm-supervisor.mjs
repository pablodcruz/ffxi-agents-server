#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCheckVerdict } from "../src/check-verdict.mjs";
import {
  hasLiveCombat,
  parseCombatRewards,
  safeCombatPosition,
  selectProactiveTarget,
  targetDefeated,
} from "../src/farm-supervisor-policy.mjs";
import {
  playerPartyMember,
  selectReactiveThreat,
} from "../src/reactive-combat-policy.mjs";
import { FARM_CONFIRMATION } from "../src/farm-supervisor-manager.mjs";

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
const weaponSkill = safeLabel(argument("--weapon-skill", "Combo"), "--weapon-skill");

if (!/^[A-Za-z0-9_-]{1,32}$/.test(agentId)) {
  throw new Error("--agent-id is invalid.");
}
if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
  throw new Error("--lease-id must be a UUID.");
}
if (argument("--confirmation") !== FARM_CONFIRMATION) {
  throw new Error(`Supervisor requires --confirmation "${FARM_CONFIRMATION}".`);
}

const runtimeDir = path.join(projectDir, "runtime", "farm-supervisor");
const statePath = path.join(runtimeDir, `${agentId}.json`);
const stopPath = path.join(runtimeDir, `${leaseId}.stop`);
const metadataPath = path.join(
  projectDir,
  "runtime",
  "mob-metadata",
  `zone-${zoneId}.json`,
);
const pollMilliseconds = 200;
const threatDistance = 20;
const cooldownMilliseconds = 30_000;
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
  gil_earned: 0,
  exp_earned: 0,
  excluded_pulls: 0,
  attack_rejections: 0,
  target_cycle_errors: 0,
  teleport_while_engaged: 0,
  recovery_while_engaged: 0,
};
const metrics = {
  aggro_response_samples: 0,
  last_aggro_response_ms: null,
  maximum_aggro_response_ms: null,
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
let lastStateWriteAt = 0;
let missingTargetSamples = 0;
let stopping = false;
let recovering = false;
const cooldowns = new Map();
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
      weapon_skill: weaponSkill,
    },
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
  if (observedZoneId !== zoneId) {
    stopReason = `zone_changed:${observedZoneId || "unknown"}`;
    return false;
  }
  if (Number(observation?.player?.hp_percent) <= 0) {
    counters.deaths += 1;
    stopReason = "player_defeated";
    return false;
  }
  return true;
}

async function stopRequested() {
  if (stopping) return true;
  try {
    await fs.access(stopPath);
    stopReason = "stop_requested";
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
  };
  currentMode = mode;
  missingTargetSamples = 0;
  if (mode === "reactive") {
    const firstSeen = threatFirstSeen.get(Number(target.server_id));
    if (firstSeen) {
      const responseMs = Date.now() - firstSeen;
      metrics.aggro_response_samples += 1;
      metrics.last_aggro_response_ms = responseMs;
      metrics.maximum_aggro_response_ms = Math.max(
        Number(metrics.maximum_aggro_response_ms) || 0,
        responseMs,
      );
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
    aggro_response_ms: metrics.last_aggro_response_ms,
  });
  await transition("fighting");
  if (mode === "reactive") {
    const closed = await closeWithTargetFollow(targeted, target);
    const closedTarget = entityById(closed, target.server_id);
    currentTarget.attack_baseline_event_id = maxObservedEventId(closed);
    currentTarget.attack_issued_at_ms = Date.now();
    await command("/attack <t>");
    log("reactive_attack_reissued", {
      name: target.name,
      server_id: target.server_id,
      distance: closedTarget?.distance,
    });
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
      if (Number(observation?.player?.hp_percent) >= minimumStartHpPercent) {
        break;
      }
      if (await stopRequested()) break;
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
    zone_id: zoneId,
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
    await command("/attackoff").catch(() => {});
    currentTarget = null;
    currentMode = null;
    await new Promise((resolve) => setTimeout(resolve, 300));
    let retryObservation = await sample();
    const settled = await waitForIdleStance(retryObservation);
    retryObservation = settled.observation;
    const defensiveThreat = settled.threat;
    if (defensiveThreat) {
      await engage(defensiveThreat, "reactive", {
        handoff: rejectedTarget.handoff,
        attempt: Number(rejectedTarget.attack_attempts) + 1,
        observation: retryObservation,
      });
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
        retryObservation = await positionNear(retryTarget, retryObservation, {
          force: true,
          offset: 2,
        });
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
      await engage(nextThreat, "reactive", {
        handoff: true,
        observation,
      });
      return;
    }
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
    await engage(threat, "reactive", {
      handoff: true,
      observation,
    });
    return;
  }
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
  const metadataDocument = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const metadata = metadataDocument.mobs || [];
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
  });

  let observation = await observe();
  lastEventId = maxObservedEventId(observation);
  observeThreats(observation);
  await writeState();
  while (!stopping) {
    if (Date.now() - startedAt >= maximumSeconds * 1000) {
      stopReason = "time_limit";
      break;
    }
    if (counters.fights_completed >= maximumFights) {
      stopReason = "fight_limit";
      break;
    }
    if (await stopRequested()) break;

    observation = await sample();
    if (!verifySession(observation)) break;

    if (currentTarget) {
      await handleFight(observation);
      continue;
    }

    const reactiveThreat = selectReactiveThreat(observation, {
      maxDistance: threatDistance,
    });
    if (reactiveThreat) {
      await engage(reactiveThreat, "reactive", {
        handoff: previousTargetId !== null,
        observation,
      });
      continue;
    }

    const recovery = await recover(observation);
    observation = recovery.observation;
    if (stopReason) break;
    if (recovery.threat) {
      await engage(recovery.threat, "reactive", {
        handoff: previousTargetId !== null,
        observation,
      });
      continue;
    }
    if (Number(observation?.player?.status) !== 0) {
      await transition("settling", {
        player_status: observation?.player?.status,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    await transition("scouting");
    const partyPlayer = playerPartyMember(observation);
    const target = selectProactiveTarget({
      observation,
      metadata,
      playerLevel: Number(partyPlayer?.main_job_level),
      zoneId,
      radius: scanRadius,
      excludedServerIds: excludedServerIds(),
    });
    if (!target) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    try {
      observation = await positionNear(target, observation);
      if (!verifySession(observation)) break;
      const positionThreat = selectReactiveThreat(observation, {
        maxDistance: threatDistance,
      });
      if (positionThreat) {
        await engage(positionThreat, "reactive", {
          handoff: previousTargetId !== null,
          observation,
        });
        continue;
      }
      const positionedTarget = entityById(observation, target.server_id);
      if (!positionedTarget || Number(positionedTarget.hp_percent) <= 0) {
        cooldowns.set(Number(target.server_id), Date.now() + 5000);
        continue;
      }

      const checked = await checkTarget(target, observation);
      observation = checked.observation;
      if (checked.threat) {
        await engage(checked.threat, "reactive", {
          handoff: previousTargetId !== null,
          observation,
        });
        continue;
      }
      if (checked.verdict?.verdict !== "safe") {
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
