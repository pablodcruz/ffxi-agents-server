export function selectSafeTarget({
  player,
  entities,
  allowedNames,
  maximumDistance = 20,
  maximumElevationDifference = 4,
}) {
  if (!player?.position || !Array.isArray(entities)) return null;
  const names = new Set(allowedNames || []);
  return entities
    .filter((entity) => (
      names.has(entity.name)
      && entity.entity_type === 2
      && entity.status === 0
      && entity.hp_percent > 0
      && Number.isFinite(entity.distance)
      && entity.distance <= maximumDistance
      && Number.isFinite(entity.position?.z)
      && Math.abs(entity.position.z - player.position.z)
        <= maximumElevationDifference
    ))
    .sort((left, right) => (
      left.distance - right.distance
      || left.server_id - right.server_id
    ))[0] || null;
}
