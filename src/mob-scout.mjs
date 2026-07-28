const defaultExcludedNamePatterns = Object.freeze([
  /hornet/i,
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeName(value) {
  return String(value || "").replaceAll("_", " ").trim();
}

export function zoneMobIdRange(zoneId) {
  const parsed = Number(zoneId);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999) {
    throw new Error("zoneId must be an integer from 0 through 999.");
  }
  const start = 0x01000000 + (parsed * 0x1000);
  return { start, end: start + 0x1000 };
}

export function conservativeVendorValue(drops = []) {
  return drops.reduce((total, drop) => {
    const itemRate = finiteNumber(drop.item_rate);
    const groupRate = finiteNumber(drop.group_rate, 1000);
    const baseSell = finiteNumber(drop.base_sell);
    if (itemRate <= 0 || groupRate <= 0 || baseSell <= 0) return total;
    return total + ((itemRate / 1000) * (groupRate / 1000) * baseSell);
  }, 0);
}

export function parseMobMetadataTsv(tsv, zoneId) {
  const mobs = new Map();
  for (const line of String(tsv || "").split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields.length < 20) {
      throw new Error(`Mob metadata row has ${fields.length} fields; expected 20.`);
    }
    const [
      mobId,
      name,
      minimumLevel,
      maximumLevel,
      spawnX,
      spawnZ,
      spawnY,
      dropId,
      aggro,
      links,
      trueDetection,
      behavior,
      mobType,
      dropType,
      groupId,
      groupRate,
      itemId,
      itemRate,
      itemName,
      baseSell,
    ] = fields;

    const id = Number(mobId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid mob id in metadata row: ${mobId}`);
    }
    let mob = mobs.get(id);
    if (!mob) {
      mob = {
        server_id: id,
        name: normalizeName(name),
        zone_id: Number(zoneId),
        minimum_level: Number(minimumLevel),
        maximum_level: Number(maximumLevel),
        spawn: {
          x: Number(spawnX),
          y: Number(spawnY),
          z: Number(spawnZ),
        },
        drop_id: Number(dropId),
        aggro: Number(aggro) !== 0,
        links: Number(links) !== 0,
        true_detection: Number(trueDetection) !== 0,
        behavior: Number(behavior),
        mob_type: Number(mobType),
        drops: [],
      };
      mobs.set(id, mob);
    }

    const parsedItemId = Number(itemId);
    if (Number.isInteger(parsedItemId) && parsedItemId > 0) {
      mob.drops.push({
        drop_type: Number(dropType),
        group_id: Number(groupId),
        group_rate: Number(groupRate),
        item_id: parsedItemId,
        item_rate: Number(itemRate),
        item_name: normalizeName(itemName),
        base_sell: Number(baseSell),
      });
    }
  }

  return [...mobs.values()].map((mob) => ({
    ...mob,
    conservative_vendor_value: conservativeVendorValue(mob.drops),
  }));
}

export function classifyMob({
  entity,
  metadata,
  playerLevel,
  maximumElevationDifference = 4,
  excludedNamePatterns = defaultExcludedNamePatterns,
  excludedServerIds = new Set(),
}) {
  const reasons = [];
  const elevationDifference = Math.abs(
    finiteNumber(entity?.position?.z) - finiteNumber(entity?.player_z),
  );

  if (!metadata) reasons.push("metadata_missing");
  if (entity?.entity_type !== 2) reasons.push("not_monster");
  if (entity?.status !== 0 || finiteNumber(entity?.hp_percent) <= 0) {
    reasons.push("not_active");
  }
  if (elevationDifference > maximumElevationDifference) {
    reasons.push("vertical_separation");
  }
  if (excludedNamePatterns.some((pattern) => pattern.test(entity?.name || ""))) {
    reasons.push("excluded_mob_policy");
  }
  if (excludedServerIds.has(Number(entity?.server_id))) {
    reasons.push("temporary_target_cooldown");
  }
  if (metadata?.aggro) reasons.push("aggressive");
  if (metadata?.links) reasons.push("links");

  let disposition = "avoid";
  if (reasons.length === 0) {
    if (metadata.maximum_level <= playerLevel - 1) {
      disposition = "low_risk_candidate";
    } else if (metadata.minimum_level <= playerLevel) {
      disposition = "requires_exact_check";
    } else {
      reasons.push("level_range_above_player");
    }
  }

  return {
    disposition,
    reasons,
    elevation_difference: elevationDifference,
    check_required: disposition !== "avoid",
  };
}

export function rankNearbyMobs({
  observation,
  metadata,
  playerLevel,
  maximumElevationDifference = 4,
  excludedNamePatterns = defaultExcludedNamePatterns,
  excludedServerIds = new Set(),
}) {
  const byId = new Map(
    (metadata || []).map((mob) => [Number(mob.server_id), mob]),
  );
  const playerZ = observation?.player?.position?.z;
  const priority = {
    low_risk_candidate: 0,
    requires_exact_check: 1,
    avoid: 2,
  };

  return (observation?.nearby_entities || [])
    .filter((entity) => entity.entity_type === 2)
    .map((entity) => {
      const mob = byId.get(Number(entity.server_id));
      const classification = classifyMob({
        entity: { ...entity, player_z: playerZ },
        metadata: mob,
        playerLevel,
        maximumElevationDifference,
        excludedNamePatterns,
        excludedServerIds,
      });
      return {
        server_id: entity.server_id,
        name: entity.name,
        distance: entity.distance,
        position: entity.position,
        hp_percent: entity.hp_percent,
        ...classification,
        metadata: mob
          ? {
              minimum_level: mob.minimum_level,
              maximum_level: mob.maximum_level,
              aggro: mob.aggro,
              links: mob.links,
              true_detection: mob.true_detection,
              spawn: mob.spawn,
              conservative_vendor_value: mob.conservative_vendor_value,
              valuable_drops: mob.drops
                .filter((drop) => drop.base_sell > 0 && drop.item_rate > 0)
                .sort((left, right) => (
                  (right.base_sell * right.item_rate)
                  - (left.base_sell * left.item_rate)
                ))
                .slice(0, 5),
            }
          : null,
      };
    })
    .sort((left, right) => (
      priority[left.disposition] - priority[right.disposition]
      || finiteNumber(right.metadata?.conservative_vendor_value)
        - finiteNumber(left.metadata?.conservative_vendor_value)
      || finiteNumber(left.distance, Infinity) - finiteNumber(right.distance, Infinity)
      || Number(left.server_id) - Number(right.server_id)
    ));
}
