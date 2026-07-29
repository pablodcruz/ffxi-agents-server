import { rankNearbyMobs } from "./mob-scout.mjs";

export const defaultExcludedCombatPockets = Object.freeze([
  Object.freeze({
    zone_id: 107,
    x: 10,
    y: -170,
    radius: 35,
    reason: "unvalidated_quadav_multi_aggro",
  }),
]);

export function hasLiveCombat(observation) {
  return Number(observation?.player?.status) === 1
    || (observation?.nearby_entities || []).some(
      (entity) => Number(entity?.status) === 1 && Number(entity?.hp_percent) > 0,
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

export function selectRelocationCamp({
  metadata,
  playerLevel,
  zoneId,
  currentPosition,
  excludedServerIds = new Set(),
  allowedNames = ["Mad Sheep", "Sand Hare"],
  clusterRadius = 30,
  minimumAggroDistance = 40,
  minimumTravelDistance = 20,
  maximumElevationDifference = 4,
}) {
  const normalizedNames = new Set(
    allowedNames.map((name) => String(name).toLowerCase()),
  );
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
    && normalizedNames.has(String(mob?.name || "").toLowerCase())
    && !mob?.aggro
    && finiteSpawn(mob)
    && Number(mob.maximum_level) <= Number(playerLevel) - 1
    && Number(mob.maximum_level) >= Number(playerLevel) - 3
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

export function latestLineOfSightFailure(events, {
  afterEventId = 0,
} = {}) {
  return (events || [])
    .filter((event) => (
      Number(event?.id) > Number(afterEventId)
      && Number(event?.mode) === 122
      && /(?:unable to|cannot) see\b/i.test(
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
  lastCommandAt,
  now = Date.now(),
  retryAfterMs = 2000,
}) {
  return Number(observation?.player?.hp_percent) < Number(minimumHpPercent)
    && Number(observation?.player?.status) === 0
    && Number(now) - Number(lastCommandAt) >= Number(retryAfterMs);
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
