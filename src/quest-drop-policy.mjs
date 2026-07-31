export function selectQuestDropTarget({
  observation,
  metadata,
  itemId,
  allowedNames,
  preferredNames = [],
  playerLevel,
  radius = 30,
  excludedServerIds = new Set(),
  maximumElevationDifference = 4,
  maximumLevelOffset = 4,
}) {
  const byId = new Map(
    (metadata || []).map((mob) => [Number(mob.server_id), mob]),
  );
  const names = new Set((allowedNames || []).map((name) => String(name)));
  const preferred = new Set(
    (preferredNames || []).map((name) => String(name)),
  );
  const playerZ = Number(observation?.player?.position?.z);
  return (observation?.nearby_entities || [])
    .filter((entity) => {
      const mob = byId.get(Number(entity.server_id));
      return entity.entity_type === 2
        && entity.status === 0
        && Number(entity.hp_percent) > 0
        && Number(entity.distance) <= Number(radius)
        && (names.size === 0 || names.has(String(entity.name)))
        && !excludedServerIds.has(Number(entity.server_id))
        && mob
        && Number(mob.mob_type) === 0
        && Number(mob.maximum_level) <= Number(playerLevel)
          + Number(maximumLevelOffset)
        && Math.abs(Number(entity.position?.z) - playerZ)
          <= Number(maximumElevationDifference)
        && (mob.drops || []).some(
          (drop) => (
            Number(drop.item_id) === Number(itemId)
            && Number(drop.item_rate) > 0
          ),
        );
    })
    .map((entity) => ({
      ...entity,
      metadata: byId.get(Number(entity.server_id)),
    }))
    .sort((left, right) => (
      Number(!preferred.has(String(left.name)))
      - Number(!preferred.has(String(right.name)))
      || Number(left.metadata.maximum_level) - Number(right.metadata.maximum_level)
      || Number(left.distance) - Number(right.distance)
      || Number(left.server_id) - Number(right.server_id)
    ))[0] || null;
}

export function selectWatchedDropTarget({
  observation,
  metadata,
  itemId,
  playerLevel,
  radius = 30,
  excludedServerIds = new Set(),
  maximumElevationDifference = 4,
  maximumLevelOffset = 1,
}) {
  const byId = new Map(
    (metadata || []).map((mob) => [Number(mob.server_id), mob]),
  );
  const dropMobs = (metadata || []).filter((mob) => (
    [0, 2].includes(Number(mob.mob_type || 0))
    && (mob.drops || []).some((drop) => (
      Number(drop.item_id) === Number(itemId)
      && Number(drop.item_rate) > 0
    ))
  ));
  const dropMobIds = new Set(dropMobs.map((mob) => Number(mob.server_id)));
  const dropSlots = new Set(
    dropMobs
      .map((mob) => Number(mob.spawn_slot_id))
      .filter((slotId) => slotId > 0),
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
        && mob
        && [0, 2].includes(Number(mob.mob_type || 0))
        && (
          dropMobIds.has(Number(entity.server_id))
          || dropSlots.has(Number(mob.spawn_slot_id))
        )
        && Number(mob.maximum_level) <= Number(playerLevel)
          + Number(maximumLevelOffset)
        && Math.abs(Number(entity.position?.z) - playerZ)
          <= Number(maximumElevationDifference);
    })
    .map((entity) => ({
      ...entity,
      metadata: byId.get(Number(entity.server_id)),
      watched_drop_role: dropMobIds.has(Number(entity.server_id))
        ? "drop_bearer"
        : "spawn_slot_placeholder",
    }))
    .sort((left, right) => (
      Number(left.watched_drop_role !== "drop_bearer")
      - Number(right.watched_drop_role !== "drop_bearer")
      || Number(left.distance) - Number(right.distance)
      || Number(left.server_id) - Number(right.server_id)
    ))[0] || null;
}

export function selectExactLotteryTarget({
  observation,
  metadata,
  placeholderServerIds,
  notoriousMonsterServerIds,
  playerLevel,
  radius = 50,
  excludedServerIds = new Set(),
  maximumElevationDifference = 10,
  maximumLevelOffset = 4,
}) {
  const byId = new Map(
    (metadata || []).map((mob) => [Number(mob.server_id), mob]),
  );
  const placeholders = new Set(
    (placeholderServerIds || []).map((serverId) => Number(serverId)),
  );
  const notoriousMonsters = new Set(
    (notoriousMonsterServerIds || []).map((serverId) => Number(serverId)),
  );
  const allowed = new Set([...placeholders, ...notoriousMonsters]);
  const playerZ = Number(observation?.player?.position?.z);

  return (observation?.nearby_entities || [])
    .filter((entity) => {
      const serverId = Number(entity.server_id);
      const mob = byId.get(serverId);
      return entity.entity_type === 2
        && Number(entity.status) === 0
        && Number(entity.hp_percent) > 0
        && Number(entity.distance) <= Number(radius)
        && allowed.has(serverId)
        && !excludedServerIds.has(serverId)
        && mob
        && Number(mob.maximum_level) <= Number(playerLevel)
          + Number(maximumLevelOffset)
        && Math.abs(Number(entity.position?.z) - playerZ)
          <= Number(maximumElevationDifference);
    })
    .map((entity) => ({
      ...entity,
      metadata: byId.get(Number(entity.server_id)),
      lottery_role: notoriousMonsters.has(Number(entity.server_id))
        ? "notorious_monster"
        : "placeholder",
    }))
    .sort((left, right) => (
      Number(left.lottery_role !== "notorious_monster")
      - Number(right.lottery_role !== "notorious_monster")
      || Number(left.distance) - Number(right.distance)
      || Number(left.server_id) - Number(right.server_id)
    ))[0] || null;
}
