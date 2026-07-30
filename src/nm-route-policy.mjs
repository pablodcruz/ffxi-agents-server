export function inventoryHasFreeSlots(state, minimumFreeSlots) {
  const count = Number(state?.inventory?.count);
  const capacity = Number(state?.inventory?.capacity);
  return Number.isInteger(count)
    && Number.isInteger(capacity)
    && capacity - count >= Number(minimumFreeSlots);
}

export function watchedItemsOwned(profile, ownedItemIds) {
  const owned = ownedItemIds instanceof Set
    ? ownedItemIds
    : new Set((ownedItemIds || []).map((itemId) => Number(itemId)));
  const watched = profile?.watched_items || [];
  return watched.length > 0
    && watched.every((item) => owned.has(Number(item.item_id)));
}

export function routePlaceholderIds(profile, placeholderKills) {
  const killed = placeholderKills instanceof Set
    ? placeholderKills
    : new Set(placeholderKills || []);
  if (
    killed.size >= Number(profile?.maximum_placeholder_kills_per_visit || 1)
  ) {
    return [];
  }
  return (profile?.placeholder_server_ids || []).filter(
    (serverId) => !killed.has(Number(serverId)),
  );
}

export function nextRoutePosition({
  profile,
  sweepIndex,
}) {
  const positions = profile?.sweep_positions || [];
  if (
    !Number.isInteger(sweepIndex)
    || sweepIndex < 0
    || sweepIndex >= positions.length
  ) {
    return null;
  }
  return positions[sweepIndex];
}

export function nextRouteCamp({
  campIndex,
  round,
  profileCount,
  maximumRounds,
}) {
  if (campIndex + 1 < profileCount) {
    return {
      complete: false,
      camp_index: campIndex + 1,
      round,
    };
  }
  if (round >= maximumRounds) {
    return {
      complete: true,
      camp_index: campIndex,
      round,
    };
  }
  return {
    complete: false,
    camp_index: 0,
    round: round + 1,
  };
}
