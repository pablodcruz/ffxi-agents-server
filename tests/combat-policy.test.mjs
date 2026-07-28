import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRetryAttackRegistration,
  shouldUseWeaponSkill,
} from "../src/combat-policy.mjs";

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

test("uses a weapon skill only after exact-target engagement with sufficient TP", () => {
  const ready = {
    configured: true,
    engagementObserved: true,
    exactTargetSelected: true,
    tp: 1000,
    now: 6000,
    lastAttemptAt: 0,
  };
  assert.equal(shouldUseWeaponSkill(ready), true);
  assert.equal(shouldUseWeaponSkill({ ...ready, engagementObserved: false }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, exactTargetSelected: false }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, tp: 999 }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, now: 4000 }), false);
});
