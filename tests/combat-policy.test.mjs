import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryAttackRegistration } from "../src/combat-policy.mjs";

const idleRejection = {
  attempts: 1,
  attemptLimit: 3,
  startPlayerHpPercent: 100,
  currentPlayerHpPercent: 100,
  startTargetHpPercent: 100,
  currentTargetHpPercent: 100,
};

test("retries a bounded attack rejection only before combat starts", () => {
  assert.equal(shouldRetryAttackRegistration(idleRejection), true);
  assert.equal(shouldRetryAttackRegistration({
    ...idleRejection,
    currentPlayerHpPercent: 97,
  }), false);
  assert.equal(shouldRetryAttackRegistration({
    ...idleRejection,
    currentTargetHpPercent: 92,
  }), false);
});

test("rejects exhausted and incomplete attack retry evidence", () => {
  assert.equal(shouldRetryAttackRegistration({
    ...idleRejection,
    attempts: 3,
  }), false);
  assert.equal(shouldRetryAttackRegistration({
    ...idleRejection,
    currentTargetHpPercent: undefined,
  }), false);
});
