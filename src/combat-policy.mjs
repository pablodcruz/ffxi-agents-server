function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function shouldRetryAttackRegistration({
  attempts,
  attemptLimit,
  startPlayerHpPercent,
  currentPlayerHpPercent,
  startTargetHpPercent,
  currentTargetHpPercent,
}) {
  if (
    !Number.isInteger(attempts)
    || !Number.isInteger(attemptLimit)
    || attempts < 1
    || attemptLimit < 1
    || attempts >= attemptLimit
  ) {
    return false;
  }

  const startPlayerHp = finiteNumber(startPlayerHpPercent);
  const currentPlayerHp = finiteNumber(currentPlayerHpPercent);
  const startTargetHp = finiteNumber(startTargetHpPercent);
  const currentTargetHp = finiteNumber(currentTargetHpPercent);
  if (
    startPlayerHp === undefined
    || currentPlayerHp === undefined
    || startTargetHp === undefined
    || currentTargetHp === undefined
  ) {
    return false;
  }

  return currentPlayerHp >= startPlayerHp && currentTargetHp >= startTargetHp;
}

export function shouldUseWeaponSkill({
  configured,
  engagementObserved,
  exactTargetSelected,
  tp,
  now,
  lastAttemptAt,
  minimumIntervalMs = 5000,
}) {
  const currentTp = finiteNumber(tp);
  const currentTime = finiteNumber(now);
  const previousAttempt = finiteNumber(lastAttemptAt);
  return Boolean(configured)
    && engagementObserved === true
    && exactTargetSelected === true
    && currentTp !== undefined
    && currentTp >= 1000
    && currentTime !== undefined
    && previousAttempt !== undefined
    && currentTime - previousAttempt >= minimumIntervalMs;
}
