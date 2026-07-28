function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function movementUnsafeReason({
  loginStatus,
  playerStatus,
  playerHpPercent,
  baselineHpPercent,
}) {
  if (Number(loginStatus) !== 2) return "login_state_changed";

  const hp = finiteNumber(playerHpPercent);
  const baselineHp = finiteNumber(baselineHpPercent);
  if (Number(playerStatus) === 3 || hp === undefined || hp <= 0) {
    return "player_defeated";
  }
  if (baselineHp !== undefined && hp < baselineHp) {
    return "player_hp_lost";
  }
  return null;
}
