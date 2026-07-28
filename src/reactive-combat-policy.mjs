function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function activePartyServerIds(observation) {
  return new Set(
    (observation?.party || [])
      .map((member) => Number(member?.server_id))
      .filter((serverId) => Number.isInteger(serverId) && serverId > 0),
  );
}

export function playerPartyMember(observation) {
  return (observation?.party || []).find(
    (member) => Number(member?.server_id) === Number(observation?.player?.server_id),
  ) || (observation?.party || []).find((member) => Number(member?.slot) === 0);
}

export function selectReactiveThreat(observation, {
  maxDistance = 12,
  excludedServerIds = [],
} = {}) {
  const distanceLimit = finiteNumber(maxDistance);
  if (!observation || distanceLimit === undefined || distanceLimit <= 0) return null;

  const partyIds = activePartyServerIds(observation);
  const excludedIds = new Set(
    excludedServerIds
      .map(Number)
      .filter((serverId) => Number.isInteger(serverId) && serverId > 0),
  );
  const candidates = (observation.nearby_entities || []).filter((entity) => {
    const serverId = Number(entity?.server_id);
    const distance = finiteNumber(entity?.distance);
    const hpPercent = finiteNumber(entity?.hp_percent);
    return Number.isInteger(serverId)
      && serverId > 0
      && !partyIds.has(serverId)
      && !excludedIds.has(serverId)
      && Number(entity?.status) === 1
      && distance !== undefined
      && distance <= distanceLimit
      && hpPercent !== undefined
      && hpPercent > 0;
  });

  const exactTargetId = Number(observation.target?.server_id);
  return candidates.find((entity) => Number(entity.server_id) === exactTargetId)
    || candidates.sort((left, right) => (
      Number(left.distance) - Number(right.distance)
      || Number(left.hp_percent) - Number(right.hp_percent)
      || Number(left.server_id) - Number(right.server_id)
    ))[0]
    || null;
}

export function reactiveThreatSignal({
  observation,
  previousHpPercent,
  threatWindowUntil = 0,
  now = Date.now(),
  privateSolo = false,
}) {
  const currentHp = finiteNumber(observation?.player?.hp_percent);
  const previousHp = finiteNumber(previousHpPercent);
  const hpDropped = currentHp !== undefined
    && previousHp !== undefined
    && currentHp < previousHp;
  const playerFighting = Number(observation?.player?.status) === 1;
  const withinThreatWindow = finiteNumber(now) <= finiteNumber(threatWindowUntil);
  return {
    active: hpDropped || playerFighting || withinThreatWindow || privateSolo === true,
    hpDropped,
    playerFighting,
    withinThreatWindow,
  };
}
