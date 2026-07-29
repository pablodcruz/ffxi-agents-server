const monkAbilities = Object.freeze([
  Object.freeze({
    name: "Chakra",
    minimum_level: 35,
    cooldown_ms: 300_500,
    maximum_hp_percent: 70,
    priority: 0,
  }),
  Object.freeze({
    name: "Dodge",
    minimum_level: 15,
    cooldown_ms: 300_500,
    priority: 1,
  }),
  Object.freeze({
    name: "Focus",
    minimum_level: 25,
    cooldown_ms: 300_500,
    priority: 2,
  }),
  Object.freeze({
    name: "Boost",
    minimum_level: 5,
    cooldown_ms: 15_500,
    priority: 3,
  }),
]);

export function selectReadyJobAbility({
  mainJobId,
  mainJobLevel,
  playerHpPercent,
  inCombat,
  targetHpPercent,
  lastUsedAt = new Map(),
  lastAnyAbilityAt = 0,
  now = Date.now(),
  minimumGlobalGapMs = 2_500,
}) {
  if (
    Number(mainJobId) !== 2
    || !inCombat
    || Number(targetHpPercent) <= 10
    || Number(now) - Number(lastAnyAbilityAt) < Number(minimumGlobalGapMs)
  ) {
    return null;
  }

  return monkAbilities
    .filter((ability) => (
      Number(mainJobLevel) >= ability.minimum_level
      && Number(now) - Number(lastUsedAt.get(ability.name) || 0)
        >= ability.cooldown_ms
      && (
        ability.maximum_hp_percent === undefined
        || Number(playerHpPercent) <= ability.maximum_hp_percent
      )
    ))
    .sort((left, right) => left.priority - right.priority)[0] || null;
}

export function supportedMonkAbilities() {
  return monkAbilities.map((ability) => ({ ...ability }));
}
