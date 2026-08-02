import { rankNearbyMobs } from "./mob-scout.mjs";

export const defaultExcludedCombatPockets = Object.freeze([
  Object.freeze({
    zone_id: 107,
    x: 10,
    y: -170,
    radius: 35,
    reason: "unvalidated_quadav_multi_aggro",
  }),
  Object.freeze({
    zone_id: 107,
    x: -510,
    y: -430,
    radius: 100,
    reason: "validated_shrapnel_multi_aggro",
  }),
]);

export function hasLiveCombat(observation) {
  return Number(observation?.player?.status) === 1
    || (observation?.nearby_entities || []).some(
      (entity) => Number(entity?.status) === 1 && Number(entity?.hp_percent) > 0,
    );
}

export function isRecoverableMovementRace(error) {
  return /Position waypoint is beyond max_start_distance/i.test(
    error instanceof Error ? error.message : String(error || ""),
  );
}

export function excludedCombatPocket({
  zoneId,
  position,
  pockets = defaultExcludedCombatPockets,
}) {
  if (!position) return null;
  return pockets.find((pocket) => (
    Number(pocket.zone_id) === Number(zoneId)
    && Math.hypot(
      Number(position.x) - Number(pocket.x),
      Number(position.y) - Number(pocket.y),
    ) <= Number(pocket.radius)
  )) || null;
}

export function selectProactiveTarget({
  observation,
  metadata,
  playerLevel,
  zoneId,
  radius = 50,
  excludedServerIds = new Set(),
  excludedPockets = defaultExcludedCombatPockets,
}) {
  return rankNearbyMobs({
    observation,
    metadata,
    playerLevel,
    excludedServerIds,
  }).find((mob) => (
    mob.disposition !== "avoid"
    && Number(mob.distance) <= Number(radius)
    && !excludedCombatPocket({
      zoneId,
      position: mob.position,
      pockets: excludedPockets,
    })
  )) || null;
}

export function selectTrustedCampSweepTarget({
  observation,
  metadata,
  playerLevel,
  radius = 50,
  maximumLevelOffset = 1,
  maximumElevationDifference = 4,
  excludedServerIds = new Set(),
  excludedNamePatterns = [/\b(?:worm|stone eater|rock eater)\b/i],
}) {
  const byId = new Map(
    (metadata || []).map((mob) => [Number(mob.server_id), mob]),
  );
  const playerZ = Number(observation?.player?.position?.z);
  return (observation?.nearby_entities || [])
    .filter((entity) => {
      const mob = byId.get(Number(entity.server_id));
      return entity.entity_type === 2
        && Number(entity.status) === 0
        && Number(entity.hp_percent) > 0
        && Number(entity.distance) <= Number(radius)
        && !excludedServerIds.has(Number(entity.server_id))
        && !excludedNamePatterns.some((pattern) => pattern.test(entity.name || ""))
        && mob
        && Number(mob.mob_type || 0) === 0
        && !mob.aggro
        && Number(mob.maximum_level) <= Number(playerLevel)
          + Number(maximumLevelOffset)
        && Math.abs(Number(entity.position?.z) - playerZ)
          <= Number(maximumElevationDifference);
    })
    .map((entity) => ({
      ...entity,
      metadata: byId.get(Number(entity.server_id)),
    }))
    .sort((left, right) => (
      Number(left.distance) - Number(right.distance)
      || Number(left.metadata.maximum_level) - Number(right.metadata.maximum_level)
      || Number(left.server_id) - Number(right.server_id)
    ))[0] || null;
}

export function relocationMaximumLevelOffset({ zoneId, playerLevel }) {
  return Number(zoneId) === 103 && Number(playerLevel) === 17 ? 0 : -1;
}

export function nextLevelBandTransition({
  autoTransition,
  activeZoneId,
  playerLevel,
  targetLevel = 20,
}) {
  if (!autoTransition || Number(targetLevel) < 20) return null;
  if (
    Number(targetLevel) >= 30
    && Number(activeZoneId) === 103
    && Number(playerLevel) >= 25
  ) {
    return {
      zone_id: 120,
      allowed_names: ["Hill Lizard", "Moon Bat"],
      maximum_level_offset: 1,
      reason: "level_25_sauromugue_lizard_bat_band",
    };
  }
  if (
    Number(targetLevel) >= 40
    && Number(activeZoneId) === 123
    && Number(playerLevel) >= 32
  ) {
    return {
      zone_id: 124,
      allowed_names: ["Yhoator Mandragora"],
      maximum_level_offset: 5,
      reason: "level_32_yhoator_mandragora_band",
    };
  }
  if (Number(activeZoneId) === 107 && Number(playerLevel) >= 14) {
    return {
      zone_id: 108,
      allowed_names: ["Mad Sheep"],
      reason: "level_14_konschtat_mad_sheep_band",
    };
  }
  if (Number(activeZoneId) === 108 && Number(playerLevel) >= 17) {
    return {
      zone_id: 103,
      allowed_names: ["Sand Hare"],
      reason: "level_17_valkurm_sand_hare_band",
    };
  }
  return null;
}

export function shouldWaitForLevelProgress({
  dirty,
  now,
  nextAttemptAt,
}) {
  return Boolean(dirty) && Number(now) < Number(nextAttemptAt);
}

export function shouldContinueSupervisorLoop({
  stopping,
  stopReason,
  cooperativeStopRequestedAt,
}) {
  return !stopping && (
    !stopReason
    || cooperativeStopRequestedAt !== null
  );
}

export function selectRelocationCamp({
  metadata,
  playerLevel,
  zoneId,
  currentPosition,
  excludedServerIds = new Set(),
  allowedServerIds = null,
  allowedNames = ["Mad Sheep", "Sand Hare"],
  clusterRadius = 30,
  minimumAggroDistance = 40,
  minimumTravelDistance = 20,
  maximumElevationDifference = 4,
  minimumLevelOffset = 3,
  maximumLevelOffset = -1,
  allowAggressiveCandidates = false,
}) {
  const normalizedNames = allowedNames
    ? new Set(allowedNames.map((name) => String(name).toLowerCase()))
    : null;
  const normalizedServerIds = allowedServerIds
    ? new Set([...allowedServerIds].map(Number))
    : null;
  const finiteSpawn = (mob) => (
    mob?.spawn
    && ["x", "y", "z"].every((axis) => Number.isFinite(Number(mob.spawn[axis])))
  );
  const distance = (left, right) => Math.hypot(
    Number(left.x) - Number(right.x),
    Number(left.y) - Number(right.y),
  );
  const candidates = (metadata || []).filter((mob) => (
    Number(mob?.zone_id) === Number(zoneId)
    && (
      !normalizedServerIds
      || normalizedServerIds.has(Number(mob?.server_id))
    )
    && (
      !normalizedNames
      || normalizedNames.has(String(mob?.name || "").toLowerCase())
    )
    && (
      Number(mob?.mob_type || 0) === 0
      || (
        normalizedServerIds
        && Number(mob?.mob_type || 0) === 2
      )
    )
    && !/\b(?:worm|stone eater|rock eater)\b/i.test(String(mob?.name || ""))
    && (allowAggressiveCandidates || !mob?.aggro)
    && finiteSpawn(mob)
    && Number(mob.maximum_level) <= Number(playerLevel)
      + Number(maximumLevelOffset)
    && Number(mob.maximum_level) >= Number(playerLevel)
      - Number(minimumLevelOffset)
    && !excludedServerIds.has(Number(mob.server_id))
    && !excludedCombatPocket({
      zoneId,
      position: mob.spawn,
    })
    && (
      !currentPosition
      || distance(currentPosition, mob.spawn) >= Number(minimumTravelDistance)
    )
  ));
  const aggressive = (metadata || []).filter((mob) => (
    Number(mob?.zone_id) === Number(zoneId)
    && mob?.aggro
    && finiteSpawn(mob)
  ));

  return candidates.map((mob) => {
    const cluster = candidates.filter((peer) => (
      distance(mob.spawn, peer.spawn) <= Number(clusterRadius)
      && Math.abs(Number(mob.spawn.z) - Number(peer.spawn.z))
        <= Number(maximumElevationDifference)
    ));
    const nearestAggroDistance = aggressive
      .filter((threat) => (
        Math.abs(Number(mob.spawn.z) - Number(threat.spawn.z)) <= 8
      ))
      .reduce(
        (nearest, threat) => Math.min(
          nearest,
          distance(mob.spawn, threat.spawn),
        ),
        Number.POSITIVE_INFINITY,
      );
    return {
      server_id: Number(mob.server_id),
      name: mob.name,
      position: {
        x: Number(mob.spawn.x),
        y: Number(mob.spawn.y),
        z: Number(mob.spawn.z),
      },
      cluster_size: cluster.length,
      cluster_server_ids: cluster.map((peer) => Number(peer.server_id)),
      nearest_aggro_distance: nearestAggroDistance,
      travel_distance: currentPosition
        ? distance(currentPosition, mob.spawn)
        : null,
    };
  }).filter((camp) => (
    camp.nearest_aggro_distance >= Number(minimumAggroDistance)
  )).sort((left, right) => (
    right.cluster_size - left.cluster_size
    || right.nearest_aggro_distance - left.nearest_aggro_distance
    || Number(left.travel_distance || 0) - Number(right.travel_distance || 0)
    || left.server_id - right.server_id
  ))[0] || null;
}

export function safeCombatPosition({
  observation,
  target,
  offset = 4,
}) {
  if (hasLiveCombat(observation)) return null;
  const player = observation?.player?.position;
  const destinationTarget = target?.position;
  if (!player || !destinationTarget) return null;

  const deltaX = Number(player.x) - Number(destinationTarget.x);
  const deltaY = Number(player.y) - Number(destinationTarget.y);
  const horizontalDistance = Math.hypot(deltaX, deltaY);
  const directionX = horizontalDistance > 0.01 ? deltaX / horizontalDistance : 1;
  const directionY = horizontalDistance > 0.01 ? deltaY / horizontalDistance : 0;
  return {
    x: Number(destinationTarget.x) + (directionX * Number(offset)),
    y: Number(destinationTarget.y) + (directionY * Number(offset)),
    z: Number(destinationTarget.z),
  };
}

export function targetDefeated(entity) {
  return !entity
    || Number(entity.hp_percent) <= 0
    || [2, 3].includes(Number(entity.status));
}

export function playerDefeated(observation) {
  return Number(observation?.player?.hp_percent) <= 0
    || Number(observation?.player?.status) === 3;
}

export function shouldReissueReactiveAttack({
  observation,
  targetServerId,
}) {
  return !(
    Number(observation?.player?.status) === 1
    && Number(observation?.target?.server_id) === Number(targetServerId)
    && Number(observation?.target?.status) === 1
    && Number(observation?.target?.hp_percent) > 0
  );
}

export function shouldRecoverDroppedEngagement({
  observation,
  target,
  lastAttemptAt = 0,
  now = Date.now(),
  retryDelayMilliseconds = 3000,
}) {
  return Number(observation?.player?.status) !== 1
    && Number(target?.status) === 1
    && Number(target?.hp_percent) > 0
    && Number(target?.distance) <= 6
    && Number(now) - Number(lastAttemptAt) >= Number(retryDelayMilliseconds);
}

export function shouldAbandonStaleEngagement({
  observation,
  target,
  outOfRangeFailure,
  lastProgressAt = 0,
  now = Date.now(),
  staleMilliseconds = 15_000,
}) {
  return Boolean(outOfRangeFailure)
    && Number(observation?.player?.status) === 1
    && Number(target?.status) === 0
    && Number(target?.hp_percent) > 0
    && Number(target?.distance) > 6
    && Number(now) - Number(lastProgressAt) >= Number(staleMilliseconds);
}

export function latestLineOfSightFailure(events, {
  afterEventId = 0,
} = {}) {
  return (events || [])
    .filter((event) => (
      Number(event?.id) > Number(afterEventId)
      && Number(event?.mode) === 122
      && /(?:(?:unable to|cannot) see\b|out of range\b)/i.test(
        String(event?.message || "").replace(/[^\x20-\x7e]+/g, " ").trim(),
      )
    ))
    .sort((left, right) => Number(right.id) - Number(left.id))[0]
    || null;
}

export function lineOfSightNudgeDestination({
  player,
  target,
  beyondDistance = 2.5,
  maximumTargetDistance = 4,
  requireEngaged = true,
}) {
  if (
    (
      requireEngaged
      && (
        Number(player?.status) !== 1
        || Number(target?.status) !== 1
      )
    )
    || Number(target?.hp_percent) <= 0
  ) {
    return null;
  }
  const playerX = Number(player?.position?.x);
  const playerY = Number(player?.position?.y);
  const targetX = Number(target?.position?.x);
  const targetY = Number(target?.position?.y);
  if (![playerX, playerY, targetX, targetY].every(Number.isFinite)) return null;
  const deltaX = targetX - playerX;
  const deltaY = targetY - playerY;
  const targetDistance = Math.hypot(deltaX, deltaY);
  if (targetDistance < 0.05 || targetDistance > Number(maximumTargetDistance)) {
    return null;
  }
  return {
    x: targetX + ((deltaX / targetDistance) * Number(beyondDistance)),
    y: targetY + ((deltaY / targetDistance) * Number(beyondDistance)),
  };
}

export function shouldRetryRecoveryCommand({
  observation,
  minimumHpPercent,
  minimumMpPercent = 0,
  lastCommandAt,
  now = Date.now(),
  retryAfterMs = 2000,
}) {
  return shouldRecoverResources({
    observation,
    minimumHpPercent,
    minimumMpPercent,
  })
    && Number(observation?.player?.status) === 0
    && Number(now) - Number(lastCommandAt) >= Number(retryAfterMs);
}

export function shouldRecoverResources({
  observation,
  minimumHpPercent,
  minimumMpPercent = 0,
}) {
  const playerPartyMember = observation?.party?.find(
    (member) => Number(member?.slot) === 0,
  );
  return Number(observation?.player?.hp_percent) < Number(minimumHpPercent)
    || (
      Number(minimumMpPercent) > 0
      && Number(playerPartyMember?.mp_percent) < Number(minimumMpPercent)
    );
}

export function shouldAutoCancelMenu({ menuName, reactiveThreat }) {
  const normalizedMenuName = String(menuName || "").trim();
  return Boolean(reactiveThreat)
    || normalizedMenuName === "menu    inline"
    || normalizedMenuName === "menu    playermo";
}

export function isClosedMenuInputRace(error) {
  return String(error?.message || error || "")
    .includes("require an open menu or dialogue");
}

export function classifyReactiveTiming({
  firstSeenAt,
  now = Date.now(),
  handoff = false,
}) {
  const elapsedMs = Number(now) - Number(firstSeenAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return { aggroResponseMs: null, handoffQueueMs: null };
  }
  return handoff
    ? { aggroResponseMs: null, handoffQueueMs: elapsedMs }
    : { aggroResponseMs: elapsedMs, handoffQueueMs: null };
}

export function canStopAtFightLimit({
  fightsCompleted,
  maximumFights,
  observation,
  currentTarget,
  reactiveThreat,
}) {
  return Number(fightsCompleted) >= Number(maximumFights)
    && !currentTarget
    && !reactiveThreat
    && !hasLiveCombat(observation);
}

export function canStopAtTimeLimit({
  timeLimitReached,
  observation,
  currentTarget,
  reactiveThreat,
}) {
  return Boolean(timeLimitReached)
    && !currentTarget
    && !reactiveThreat
    && !hasLiveCombat(observation);
}

export function canCompleteCooperativeStop({
  stopRequested,
  observation,
  currentTarget,
  reactiveThreat,
  idleSamples,
  minimumIdleSamples = 8,
}) {
  return Boolean(stopRequested)
    && !currentTarget
    && !reactiveThreat
    && !hasLiveCombat(observation)
    && Number(observation?.player?.status) === 0
    && Number(idleSamples) >= Number(minimumIdleSamples);
}

export function shouldSkipEngagementForCooperativeStop({
  mode,
  stopRequested,
}) {
  return Boolean(stopRequested) && mode === "proactive";
}

export function isFarmCheckApproved({
  checkVerdict,
  allowCaution = false,
  trustedSupportReady = false,
}) {
  if (checkVerdict?.verdict === "safe") return true;
  return Boolean(allowCaution)
    && checkVerdict?.verdict === "caution"
    && checkVerdict?.difficulty === "decent_challenge"
    && !checkVerdict?.high_evasion
    && (
      !checkVerdict?.high_defense
      || Boolean(trustedSupportReady)
    );
}

export function readyTrustSupport({
  party,
  playerName,
  zoneId,
  minimumHpPercent = 80,
  minimumCount = 2,
}) {
  const members = (party || []).filter((member) => (
    String(member?.name || "") !== String(playerName || "")
    && String(member?.name || "").trim() !== ""
    && Number(member?.hp_percent) >= Number(minimumHpPercent)
    && Number(member?.zone_id) === Number(zoneId)
  ));
  return {
    ready: members.length >= Number(minimumCount),
    members: members.map((member) => String(member.name)),
  };
}

export function shouldRefreshHealerTrust({
  party,
  playerName,
  zoneId,
  healerName = "MihliAliapoh",
  maximumMpPercent = 10,
  liveCombat = false,
  playerStatus = 0,
  menuOpen = false,
}) {
  if (liveCombat || Number(playerStatus) !== 0 || menuOpen) return false;
  const healer = (party || []).find((member) => (
    String(member?.name || "") === String(healerName)
    && String(member?.name || "") !== String(playerName || "")
    && Number(member?.zone_id) === Number(zoneId)
    && Number(member?.hp_percent) > 0
  ));
  return Boolean(healer)
    && Number(healer.mp_percent) <= Number(maximumMpPercent);
}

export function trustRepairDisposition({
  liveCombat,
  missingCount,
  supportReady,
  startedAt,
  now = Date.now(),
  timeoutMilliseconds = 60_000,
}) {
  if (liveCombat) return "combat";
  if (Number(missingCount) === 0 && Boolean(supportReady)) return "ready";
  if (
    Number.isFinite(Number(startedAt))
    && Number(now) - Number(startedAt) >= Number(timeoutMilliseconds)
  ) {
    return "timeout";
  }
  return "retry";
}

export function shouldCorrectEngagedRange({
  observation,
  target,
  lastAttemptAt = 0,
  now = Date.now(),
  minimumDistance = 2.5,
  maximumDistance = 20,
  cooldownMilliseconds = 3_000,
}) {
  const distance = Number(target?.distance);
  return Number(observation?.player?.status) === 1
    && Number(target?.status) === 1
    && Number.isFinite(distance)
    && distance > Number(minimumDistance)
    && distance <= Number(maximumDistance)
    && Number(now) - Number(lastAttemptAt) >= Number(cooldownMilliseconds);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseCombatRewards(events, {
  afterEventId = 0,
  playerName,
} = {}) {
  let lastEventId = Number(afterEventId) || 0;
  let gilEarned = 0;
  let expEarned = 0;
  if (!playerName) {
    return {
      last_event_id: Math.max(
        lastEventId,
        ...(events || []).map((event) => Number(event.id) || 0),
      ),
      gil_earned: 0,
      exp_earned: 0,
    };
  }

  const name = escapeRegExp(playerName);
  const gilPattern = new RegExp(
    `\\b${name}\\s+obtains?\\s+([0-9,]+)\\s+gil\\b`,
    "i",
  );
  const expPattern = new RegExp(
    `\\b${name}\\s+gains?\\s+([0-9,]+)\\s+experience points?\\b`,
    "i",
  );
  const ordered = (events || [])
    .filter((event) => Number(event.id) > lastEventId)
    .sort((left, right) => Number(left.id) - Number(right.id));
  for (const event of ordered) {
    const message = String(event.message || "")
      .replace(/[^\x20-\x7e]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const gil = message.match(gilPattern);
    const exp = message.match(expPattern);
    if (gil) gilEarned += Number(gil[1].replaceAll(",", ""));
    if (exp) expEarned += Number(exp[1].replaceAll(",", ""));
    lastEventId = Math.max(lastEventId, Number(event.id) || 0);
  }
  return {
    last_event_id: lastEventId,
    gil_earned: gilEarned,
    exp_earned: expEarned,
  };
}
