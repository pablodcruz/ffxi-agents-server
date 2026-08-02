#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCheckVerdict } from "../src/check-verdict.mjs";
import {
  isAttackRegistrationFailure,
  isCombatCheckApproved,
  shouldPreserveCommittedEngagement,
  shouldRetryReactiveAttackRegistration,
  shouldRetryAttackRegistration,
  shouldSkipPreCombatRecovery,
  shouldUseWeaponSkill,
} from "../src/combat-policy.mjs";
import { lineOfSightNudgeDestination } from "../src/farm-supervisor-policy.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const targetName = argument("--target");
const targetServerId = Number(argument("--server-id", "0"));
const maxStartDistance = Number(argument("--max-start-distance", "25"));
const stopDistance = Number(argument("--stop-distance", "3"));
const approachTimeoutSeconds = Number(argument("--approach-timeout", "20"));
const combatTimeoutSeconds = Number(argument("--combat-timeout", "120"));
const minimumHpPercent = Number(argument("--minimum-hp-percent", "35"));
const minimumStartHpPercent = Number(argument("--minimum-start-hp-percent", "90"));
const recoveryTimeoutSeconds = Number(argument("--recovery-timeout", "60"));
const attackAttemptsLimit = Number(argument("--attack-attempts", "3"));
const weaponSkill = argument("--weapon-skill");
const commitOnceEngaged = process.argv.includes("--commit-once-engaged");
const allowCaution = process.argv.includes("--allow-caution");
const allowEvenMatchWithTrusts = process.argv.includes(
  "--allow-even-match-with-trusts",
);
const allowEngagedToughWithTrusts = process.argv.includes(
  "--allow-engaged-tough-with-trusts",
);
const skipRecovery = process.argv.includes("--skip-recovery");
const skipKnownSafeCheck = process.argv.includes("--skip-known-safe-check");

if (!targetName) {
  throw new Error("Combat requires --target with one exact nearby entity name.");
}
if (targetName.length > 64 || /["\r\n;|]/.test(targetName)) {
  throw new Error("--target contains characters unsafe for a gameplay command.");
}
if (
  weaponSkill !== undefined
  && (
    weaponSkill.length < 1
    || weaponSkill.length > 64
    || /["\r\n;|]/.test(weaponSkill)
  )
) {
  throw new Error("--weapon-skill contains characters unsafe for a gameplay command.");
}
if (!Number.isInteger(targetServerId) || targetServerId <= 0) {
  throw new Error("Combat requires --server-id with the exact positive ID from observation.");
}
if (skipKnownSafeCheck && (!commitOnceEngaged || !allowCaution)) {
  throw new Error(
    "--skip-known-safe-check requires --commit-once-engaged and --allow-caution.",
  );
}
if (!Number.isFinite(maxStartDistance) || maxStartDistance < 2 || maxStartDistance > 40) {
  throw new Error("--max-start-distance must be a number from 2 through 40.");
}
if (!Number.isFinite(stopDistance) || stopDistance < 1 || stopDistance > 6) {
  throw new Error("--stop-distance must be a number from 1 through 6.");
}
if (
  !Number.isFinite(approachTimeoutSeconds) ||
  approachTimeoutSeconds < 1 ||
  approachTimeoutSeconds > 20
) {
  throw new Error("--approach-timeout must be a number from 1 through 20.");
}
if (
  !Number.isFinite(combatTimeoutSeconds) ||
  combatTimeoutSeconds < 5 ||
  combatTimeoutSeconds > 300
) {
  throw new Error("--combat-timeout must be a number from 5 through 300.");
}
if (
  !Number.isFinite(minimumHpPercent) ||
  minimumHpPercent < 10 ||
  minimumHpPercent > 90
) {
  throw new Error("--minimum-hp-percent must be a number from 10 through 90.");
}
if (
  !Number.isFinite(minimumStartHpPercent) ||
  minimumStartHpPercent < minimumHpPercent ||
  minimumStartHpPercent > 100
) {
  throw new Error(
    "--minimum-start-hp-percent must be between the combat HP floor and 100.",
  );
}
if (
  !Number.isFinite(recoveryTimeoutSeconds) ||
  recoveryTimeoutSeconds < 5 ||
  recoveryTimeoutSeconds > 180
) {
  throw new Error("--recovery-timeout must be a number from 5 through 180.");
}
if (
  !Number.isInteger(attackAttemptsLimit) ||
  attackAttemptsLimit < 1 ||
  attackAttemptsLimit > 3
) {
  throw new Error("--attack-attempts must be an integer from 1 through 3.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-combat", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 40, max_entities: 24, event_limit: 20 },
  });
  if (response.isError) throw new Error("FFXI observation failed.");
  return valueOf(response);
}

async function characterState() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: { include_recasts: false },
  });
  if (response.isError) throw new Error("FFXI character-state read failed.");
  return valueOf(response);
}

async function command(text) {
  const response = await client.callTool({
    name: "ffxi_gameplay_command",
    arguments: { command: text },
  });
  if (response.isError) throw new Error(`Gameplay command failed: ${text}`);
  return valueOf(response);
}

async function waitForExactTarget(serverId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const observation = await observe();
    if (observation.target?.server_id === serverId) return observation;
  }
  return null;
}

async function selectExactTarget(serverId, maxDistance) {
  const cleared = await client.callTool({
    name: "ffxi_clear_target",
    arguments: {},
  });
  if (cleared.isError || !valueOf(cleared).cleared) {
    throw new Error("Could not normalize the client target state.");
  }
  const response = await client.callTool({
    name: "ffxi_target_entity",
    arguments: {
      name: targetName,
      server_id: serverId,
      max_distance: maxDistance,
    },
  });
  if (response.isError) throw new Error(`Could not target ${targetName}.`);

  let method = "bridge_target_setter";
  let observation = await waitForExactTarget(serverId);
  if (!observation) {
    await command(`/target "${targetName}"`);
    method = "gameplay_target_command";
    observation = await waitForExactTarget(serverId);
  }
  if (!observation) {
    throw new Error(`Client target verification failed for ${targetName}.`);
  }
  return { target: valueOf(response), method };
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
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} });
  throw new Error("Approach movement did not finish within its timeout.");
}

async function followWithGameplayCommand(serverId, timeoutSeconds) {
  await selectExactTarget(serverId, maxStartDistance);
  await command("/follow <t>");
  const startedAt = Date.now();
  const deadline = startedAt + (timeoutSeconds * 1000);
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const observation = await observe();
      const entity = observation.nearby_entities?.find(
        (candidate) => candidate.server_id === serverId,
      );
      if (!entity) throw new Error(`${targetName} was lost during /follow.`);
      if (entity.distance <= stopDistance + 2) return observation;
      if (observation.login_status !== 2) {
        throw new Error("Login state changed during /follow.");
      }
      if (Date.now() - startedAt >= 750) {
        const status = await client.callTool({
          name: "ffxi_control_status",
          arguments: {},
        });
        if (status.isError || !valueOf(status).auto_running) {
          throw new Error(`/follow stopped before reaching ${targetName}.`);
        }
      }
    }
    throw new Error(`/follow did not reach ${targetName} within its timeout.`);
  } finally {
    await client.callTool({ name: "ffxi_stop_movement", arguments: {} })
      .catch(() => {});
  }
}

async function approachExactTarget(serverId, timeoutSeconds) {
  const movementResponse = await client.callTool({
    name: "ffxi_move_to_entity",
    arguments: {
      server_id: serverId,
      max_start_distance: maxStartDistance,
      stop_distance: stopDistance,
      timeout_seconds: timeoutSeconds,
      stuck_seconds: 3,
    },
  });
  if (movementResponse.isError) throw new Error(`Could not approach ${targetName}.`);
  await waitForMovement(timeoutSeconds);

  let observation = await observe();
  const entity = observation.nearby_entities?.find(
    (candidate) => candidate.server_id === serverId,
  );
  if (entity && entity.distance <= stopDistance + 2) return observation;

  observation = await followWithGameplayCommand(serverId, timeoutSeconds);
  const followedEntity = observation.nearby_entities?.find(
    (candidate) => candidate.server_id === serverId,
  );
  if (!followedEntity || followedEntity.distance > stopDistance + 2) {
    throw new Error(`${targetName} is not within safe attack range after /follow.`);
  }
  return observation;
}

async function nudgeThroughExactTarget(observation, target) {
  const destination = lineOfSightNudgeDestination({
    player: observation?.player,
    target,
    requireEngaged: false,
  });
  if (!destination) return null;
  const response = await client.callTool({
    name: "ffxi_move_to_position",
    arguments: {
      x: destination.x,
      y: destination.y,
      max_start_distance: 6,
      stop_distance: 0.5,
      timeout_seconds: 2,
      stuck_seconds: 1,
    },
  });
  if (response.isError) return null;
  await new Promise((resolve) => setTimeout(resolve, 1400));
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} })
    .catch(() => {});
  return observe();
}

async function waitForCheckVerdict(afterEventId) {
  const deadline = Date.now() + 5000;
  let observation;
  let verdict = parseCheckVerdict([], { afterEventId });
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    observation = await observe();
    verdict = parseCheckVerdict(observation.recent_events, { afterEventId });
    if (verdict.verdict !== "unknown") return { observation, verdict };
  }
  return { observation, verdict };
}

function targetDefeated(observation, serverId) {
  const entity = observation.nearby_entities?.find(
    (candidate) => candidate.server_id === serverId,
  );
  return !entity || entity.hp_percent <= 0 || entity.status === 2;
}

async function recoverHp() {
  let observation = await observe();
  const samples = [{
    at: observation.observed_at,
    player_hp_percent: observation.player?.hp_percent,
  }];
  if ((observation.player?.hp_percent ?? 0) >= minimumStartHpPercent) {
    return { rested: false, samples };
  }

  await command("/heal");
  let recovered = false;
  const deadline = Date.now() + (recoveryTimeoutSeconds * 1000);
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      observation = await observe();
      samples.push({
        at: observation.observed_at,
        player_hp_percent: observation.player?.hp_percent,
      });
      if ((observation.player?.hp_percent ?? 0) >= minimumStartHpPercent) {
        recovered = true;
        break;
      }
      if (observation.login_status !== 2) {
        throw new Error("Login state changed while recovering HP.");
      }
    }
  } finally {
    await command("/heal").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  if (!recovered) {
    throw new Error(
      `HP did not recover to ${minimumStartHpPercent}% within the timeout.`,
    );
  }
  return { rested: true, samples };
}

let result;
let failure;

try {
  await client.connect(transport);
  const beforeState = await characterState();

  await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  const preRecoveryObservation = await observe();
  const preRecoveryTarget = preRecoveryObservation.nearby_entities?.find(
    (entity) => entity.server_id === targetServerId,
  ) || (
    preRecoveryObservation.target?.server_id === targetServerId
      ? preRecoveryObservation.target
      : null
  );
  const exactTargetAlreadyEngaged = Number(preRecoveryTarget?.status) === 1;
  const recoverySkipped = shouldSkipPreCombatRecovery({
    explicitlySkipped: skipRecovery,
    exactTargetSelected: Boolean(preRecoveryTarget),
    targetStatus: preRecoveryTarget?.status,
  });
  const recoverySkipReason = skipRecovery
    ? "explicit"
    : recoverySkipped
      ? "exact_target_engaged"
      : null;
  const recovery = recoverySkipped
    ? { rested: false, samples: [] }
    : await recoverHp();
  const initialSelection = await selectExactTarget(
    targetServerId,
    maxStartDistance,
  );
  const target = initialSelection.target;

  const approached = await approachExactTarget(
    target.server_id,
    approachTimeoutSeconds,
  );
  const approachedTarget = approached.nearby_entities?.find(
    (entity) => entity.server_id === target.server_id,
  );
  if (!approachedTarget || approachedTarget.distance > stopDistance + 2) {
    throw new Error(`${targetName} is not within safe attack range after approach.`);
  }

  let attackSelection = await selectExactTarget(
    target.server_id,
    stopDistance + 2,
  );
  let checked;
  if (skipKnownSafeCheck) {
    checked = {
      observation: await observe(),
      verdict: {
        event_id: null,
        message: "Skipped for an exact, metadata-pinned quest target.",
        difficulty: "too_weak",
        verdict: "safe",
        high_defense: false,
        high_evasion: false,
      },
    };
  } else {
    const checkBaselineEventId = Math.max(
      0,
      ...(approached.recent_events || []).map((event) => Number(event.id) || 0),
    );
    await command("/check <t>");
    checked = await waitForCheckVerdict(checkBaselineEventId);
  }
  const checkVerdict = checked.verdict;
  if (checkVerdict.verdict === "unknown") {
    throw new Error(`No authoritative /check result arrived for ${targetName}.`);
  }
  const playerMember = checked.observation.party?.find(
    (member) => member.server_id === checked.observation.player?.server_id,
  ) || checked.observation.party?.find((member) => member.slot === 0);
  const healthySupportCount = (checked.observation.party || []).filter(
    (member) => (
      member.server_id !== playerMember?.server_id
      && member.zone_id === playerMember?.zone_id
      && Number(member.hp_percent) > 0
    ),
  ).length;
  if (!isCombatCheckApproved({
    verdict: checkVerdict.verdict,
    difficulty: checkVerdict.difficulty,
    allowCaution,
    allowEvenMatchWithTrusts,
    allowEngagedToughWithTrusts,
    exactTargetAlreadyEngaged,
    healthySupportCount,
  })) {
    throw new Error(
      `${targetName} check verdict ${checkVerdict.verdict} is not allowed.`,
    );
  }

  let attackObservation = checked.observation;
  const checkedTarget = attackObservation.nearby_entities?.find(
    (entity) => entity.server_id === target.server_id,
  );
  if (!checkedTarget || checkedTarget.distance > stopDistance + 2) {
    attackObservation = await approachExactTarget(
      target.server_id,
      approachTimeoutSeconds,
    );
    attackSelection = await selectExactTarget(
      target.server_id,
      stopDistance + 2,
    );
  }
  let attackBaselineEventId = Math.max(
    0,
    ...(attackObservation.recent_events || []).map(
      (event) => Number(event.id) || 0,
    ),
  );
  const attackStartPlayerHp = attackObservation.player?.hp_percent;
  const attackStartTargetHp = attackObservation.nearby_entities?.find(
    (entity) => entity.server_id === target.server_id,
  )?.hp_percent;
  let attackAttempts = 1;
  const rejectedAttempts = [];

  await command("/attack <t>");

  const deadline = Date.now() + (combatTimeoutSeconds * 1000);
  const samples = [];
  let reason = "timeout";
  let rejectionEvent;
  let engagementObserved = false;
  let attackIssuedAt = Date.now();
  let lastWeaponSkillAt = 0;
  let lastChaseAt = 0;
  const weaponSkillAttempts = [];

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const observation = await observe();
    const observedTarget = observation.nearby_entities?.find(
      (entity) => entity.server_id === target.server_id,
    );
    const playerPartyMember = observation.party?.find(
      (member) => member.server_id === observation.player?.server_id,
    ) || observation.party?.find((member) => member.slot === 0);
    samples.push({
      at: observation.observed_at,
      player_hp_percent: observation.player?.hp_percent,
      target_hp_percent: observedTarget?.hp_percent,
      player_tp: playerPartyMember?.tp,
    });
    if (samples.length > 12) samples.shift();

    rejectionEvent = observation.recent_events?.find((event) => (
      (Number(event.id) || 0) > attackBaselineEventId
      && [122, 123].includes(Number(event.mode))
      && isAttackRegistrationFailure(event.message)
    ));
    if (rejectionEvent) {
      const retryAllowed = shouldRetryAttackRegistration({
        attempts: attackAttempts,
        attemptLimit: attackAttemptsLimit,
        startPlayerHpPercent: attackStartPlayerHp,
        currentPlayerHpPercent: observation.player?.hp_percent,
        startTargetHpPercent: attackStartTargetHp,
        currentTargetHpPercent: observedTarget?.hp_percent,
      }) || shouldRetryReactiveAttackRegistration({
        exactTargetAlreadyEngaged,
        attempts: attackAttempts,
        attemptLimit: attackAttemptsLimit,
        playerStatus: observation.player?.status,
        targetStatus: observedTarget?.status,
        targetHpPercent: observedTarget?.hp_percent,
      });
      rejectedAttempts.push({
        attempt: attackAttempts,
        event: rejectionEvent,
        retry_allowed: retryAllowed,
      });
      if (!retryAllowed) {
        reason = "attack_rejected_visibility";
        break;
      }

      await command("/attackoff").catch(() => {});
      let retryObservation;
      try {
        retryObservation = await nudgeThroughExactTarget(
          observation,
          observedTarget,
        ) || await approachExactTarget(
            target.server_id,
            approachTimeoutSeconds,
          );
      } catch {
        reason = "attack_retry_approach_failed";
        break;
      }
      attackSelection = await selectExactTarget(
        target.server_id,
        stopDistance + 2,
      );
      const retryTarget = retryObservation.nearby_entities?.find(
        (entity) => entity.server_id === target.server_id,
      );
      if (!retryTarget || retryTarget.distance > stopDistance + 2) {
        reason = "attack_retry_out_of_range";
        break;
      }
      attackBaselineEventId = Math.max(
        0,
        ...(retryObservation.recent_events || []).map(
          (event) => Number(event.id) || 0,
        ),
      );
      attackAttempts += 1;
      rejectionEvent = undefined;
      await command("/attack <t>");
      attackIssuedAt = Date.now();
      continue;
    }
    engagementObserved ||= (
      Number.isFinite(attackStartTargetHp)
      && (observedTarget?.hp_percent ?? attackStartTargetHp) < attackStartTargetHp
    ) || (
      Number(observedTarget?.status) === 1
    );
    if (
      !commitOnceEngaged
      && (observation.player?.hp_percent ?? 0) <= minimumHpPercent
    ) {
      reason = "low_hp";
      break;
    }
    if (targetDefeated(observation, target.server_id)) {
      reason = "target_defeated";
      break;
    }
    if (observation.login_status !== 2) {
      reason = "not_logged_in";
      break;
    }
    if (
      engagementObserved
      && observedTarget
      && Number(observedTarget.status) === 1
      && Number(observedTarget.distance) > stopDistance + 0.5
      && Date.now() - lastChaseAt >= 4000
    ) {
      lastChaseAt = Date.now();
      const chase = await client.callTool({
        name: "ffxi_move_to_entity",
        arguments: {
          server_id: target.server_id,
          max_start_distance: 40,
          stop_distance: stopDistance,
          timeout_seconds: 5,
          stuck_seconds: 2,
        },
      });
      if (!chase.isError) {
        await waitForMovement(5).catch(() => {});
      }
      continue;
    }
    if (!engagementObserved && Date.now() - attackIssuedAt >= 8000) {
      reason = "engagement_stalled";
      break;
    }
    if (shouldUseWeaponSkill({
      configured: Boolean(weaponSkill),
      engagementObserved,
      exactTargetSelected: observation.target?.server_id === target.server_id,
      tp: playerPartyMember?.tp,
      targetHpPercent: observedTarget?.hp_percent,
      now: Date.now(),
      lastAttemptAt: lastWeaponSkillAt,
    })) {
      await command(`/ws "${weaponSkill}" <t>`);
      lastWeaponSkillAt = Date.now();
      weaponSkillAttempts.push({
        at: observation.observed_at,
        tp: playerPartyMember.tp,
      });
    }
  }

  const exitObservation = await observe();
  const exitTarget = exitObservation.nearby_entities?.find(
    (entity) => entity.server_id === target.server_id,
  );
  const preservedCommittedEngagement = shouldPreserveCommittedEngagement({
    commitOnceEngaged,
    exactTargetAlreadyEngaged,
    targetStatus: exitTarget?.status,
    targetHpPercent: exitTarget?.hp_percent,
  });
  if (!preservedCommittedEngagement) {
    await command("/attackoff").catch(() => {});
  }
  // LandSandBoat emits defeat/EXP events shortly after target HP reaches zero.
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const [after, afterState] = await Promise.all([observe(), characterState()]);

  result = {
    protocol: "mcp-stdio",
    target: {
      name: target.name,
      server_id: target.server_id,
      initial_selection_method: initialSelection.method,
      attack_selection_method: attackSelection.method,
      attack_attempts: attackAttempts,
    },
    safety: {
      minimum_hp_percent: minimumHpPercent,
      minimum_start_hp_percent: minimumStartHpPercent,
      commit_once_engaged: commitOnceEngaged,
      allow_caution: allowCaution,
      allow_even_match_with_trusts: allowEvenMatchWithTrusts,
      allow_engaged_tough_with_trusts: allowEngagedToughWithTrusts,
      exact_target_already_engaged: exactTargetAlreadyEngaged,
      healthy_support_count: healthySupportCount,
      approach_timeout_seconds: approachTimeoutSeconds,
      combat_timeout_seconds: combatTimeoutSeconds,
      recovery_timeout_seconds: recoveryTimeoutSeconds,
      recovery_skipped: recoverySkipped,
      recovery_skip_reason: recoverySkipReason,
      known_safe_check_skipped: skipKnownSafeCheck,
      attack_attempts_limit: attackAttemptsLimit,
      weapon_skill: weaponSkill || null,
      preserved_committed_engagement: preservedCommittedEngagement,
    },
    reason,
    rejection_event: rejectionEvent || null,
    rejected_attempts: rejectedAttempts,
    weapon_skill_attempts: weaponSkillAttempts,
    check: checkVerdict,
    recovery,
    before: beforeState.player,
    after: afterState.player,
    samples,
    recent_events: after.recent_events,
  };
} catch (error) {
  failure = error;
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}

if (result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.reason !== "target_defeated") process.exitCode = 1;
}
if (failure) {
  throw failure;
}
