function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function isAttackRegistrationFailure(message) {
  return /^(?:Unable to (?:see|attack)\b|You must wait longer to perform that action\b)|\bis out of range\b/i
    .test(String(message || ""));
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

export function shouldRetryReactiveAttackRegistration({
  exactTargetAlreadyEngaged,
  attempts,
  attemptLimit,
  playerStatus,
  targetStatus,
  targetHpPercent,
}) {
  return exactTargetAlreadyEngaged === true
    && Number.isInteger(attempts)
    && Number.isInteger(attemptLimit)
    && attempts >= 1
    && attempts < attemptLimit
    && Number(playerStatus) !== 1
    && Number(targetStatus) === 1
    && Number(targetHpPercent) > 0;
}

export function shouldPreserveCommittedEngagement({
  commitOnceEngaged,
  exactTargetAlreadyEngaged,
  targetStatus,
  targetHpPercent,
}) {
  return commitOnceEngaged === true
    && exactTargetAlreadyEngaged === true
    && Number(targetStatus) === 1
    && Number(targetHpPercent) > 0;
}

export function shouldSkipPreCombatRecovery({
  explicitlySkipped,
  exactTargetSelected,
  targetStatus,
}) {
  return explicitlySkipped === true
    || (
      exactTargetSelected === true
      && Number(targetStatus) === 1
    );
}

export function isCombatCheckApproved({
  verdict,
  difficulty,
  allowCaution = false,
  allowEvenMatchWithTrusts = false,
  allowEngagedToughWithTrusts = false,
  exactTargetAlreadyEngaged = false,
  healthySupportCount = 0,
}) {
  if (verdict === "safe") return true;
  if (verdict === "caution") return allowCaution === true;
  if (
    verdict !== "unsafe"
    || !Number.isInteger(healthySupportCount)
    || healthySupportCount < 2
  ) {
    return false;
  }
  if (difficulty === "even_match") {
    return allowEvenMatchWithTrusts === true;
  }
  return difficulty === "tough"
    && allowEngagedToughWithTrusts === true
    && exactTargetAlreadyEngaged === true;
}

export function shouldUseWeaponSkill({
  configured,
  engagementObserved,
  exactTargetSelected,
  tp,
  targetHpPercent,
  now,
  lastAttemptAt,
  minimumIntervalMs = 5000,
  minimumTargetHpPercent = 10,
}) {
  const currentTp = finiteNumber(tp);
  const currentTargetHp = finiteNumber(targetHpPercent);
  const currentTime = finiteNumber(now);
  const previousAttempt = finiteNumber(lastAttemptAt);
  return Boolean(configured)
    && engagementObserved === true
    && exactTargetSelected === true
    && currentTp !== undefined
    && currentTp >= 1000
    && currentTargetHp !== undefined
    && currentTargetHp >= minimumTargetHpPercent
    && currentTime !== undefined
    && previousAttempt !== undefined
    && currentTime - previousAttempt >= minimumIntervalMs;
}
