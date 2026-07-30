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

const warriorAbilities = Object.freeze([
  Object.freeze({
    name: "Defender",
    minimum_level: 25,
    cooldown_ms: 300_500,
    maximum_hp_percent: 50,
    priority: 0,
  }),
  Object.freeze({
    name: "Berserk",
    minimum_level: 15,
    cooldown_ms: 300_500,
    minimum_hp_percent: 70,
    priority: 1,
  }),
  Object.freeze({
    name: "Warcry",
    minimum_level: 35,
    cooldown_ms: 300_500,
    minimum_hp_percent: 60,
    priority: 2,
  }),
  Object.freeze({
    name: "Aggressor",
    minimum_level: 45,
    cooldown_ms: 300_500,
    minimum_hp_percent: 60,
    priority: 3,
  }),
]);

// THF 1-20 has no routine ability that is both useful and geometry-free:
// Steal creates inventory pressure, Sneak Attack needs verified rear position,
// and Perfect Dodge is reserved for explicit emergencies.
const thiefAbilities = Object.freeze([]);

const abilitiesByMainJob = new Map([
  [1, warriorAbilities],
  [2, monkAbilities],
  [6, thiefAbilities],
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
    !inCombat
    || Number(targetHpPercent) <= 10
    || Number(now) - Number(lastAnyAbilityAt) < Number(minimumGlobalGapMs)
  ) {
    return null;
  }

  return (abilitiesByMainJob.get(Number(mainJobId)) || [])
    .filter((ability) => (
      Number(mainJobLevel) >= ability.minimum_level
      && Number(now) - Number(lastUsedAt.get(ability.name) || 0)
        >= ability.cooldown_ms
      && (
        ability.maximum_hp_percent === undefined
        || Number(playerHpPercent) <= ability.maximum_hp_percent
      )
      && (
        ability.minimum_hp_percent === undefined
        || Number(playerHpPercent) >= ability.minimum_hp_percent
      )
    ))
    .sort((left, right) => left.priority - right.priority)[0] || null;
}

export function supportedMonkAbilities() {
  return monkAbilities.map((ability) => ({ ...ability }));
}

export function supportedWarriorAbilities() {
  return warriorAbilities.map((ability) => ({ ...ability }));
}

export function supportedThiefAbilities() {
  return thiefAbilities.map((ability) => ({ ...ability }));
}
