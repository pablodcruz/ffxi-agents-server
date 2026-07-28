import assert from "node:assert/strict";
import test from "node:test";
import { movementUnsafeReason } from "../src/navigation-safety.mjs";

const safeState = {
  loginStatus: 2,
  playerStatus: 0,
  playerHpPercent: 74,
  baselineHpPercent: 74,
};

test("keeps movement active only while player state remains safe", () => {
  assert.equal(movementUnsafeReason(safeState), null);
  assert.equal(movementUnsafeReason({
    ...safeState,
    playerHpPercent: 73,
  }), "player_hp_lost");
  assert.equal(movementUnsafeReason({
    ...safeState,
    playerStatus: 3,
    playerHpPercent: 0,
  }), "player_defeated");
  assert.equal(movementUnsafeReason({
    ...safeState,
    loginStatus: 1,
  }), "login_state_changed");
});
