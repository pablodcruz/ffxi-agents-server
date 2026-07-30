import assert from "node:assert/strict";
import test from "node:test";
import {
  isAttackRegistrationFailure,
  isCombatCheckApproved,
  shouldPreserveCommittedEngagement,
  shouldRetryReactiveAttackRegistration,
  shouldRetryAttackRegistration,
  shouldSkipPreCombatRecovery,
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

test("recognizes visibility and action-cooldown attack registration failures", () => {
  assert.equal(isAttackRegistrationFailure("Unable to see the Snipper.\u007f1"), true);
  assert.equal(
    isAttackRegistrationFailure("You must wait longer to perform that action.\u007f1"),
    true,
  );
  assert.equal(
    isAttackRegistrationFailure("Warchief Vatgit is out of range.\u007f1"),
    true,
  );
  assert.equal(isAttackRegistrationFailure("The Snipper hits Pablo."), false);
});

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

test("retries an exact reactive attack while the mob fights a Trust", () => {
  const reactive = {
    exactTargetAlreadyEngaged: true,
    attempts: 1,
    attemptLimit: 3,
    playerStatus: 0,
    targetStatus: 1,
    targetHpPercent: 68,
  };
  assert.equal(shouldRetryReactiveAttackRegistration(reactive), true);
  assert.equal(shouldRetryReactiveAttackRegistration({
    ...reactive,
    playerStatus: 1,
  }), false);
  assert.equal(shouldRetryReactiveAttackRegistration({
    ...reactive,
    targetStatus: 0,
  }), false);
  assert.equal(shouldRetryReactiveAttackRegistration({
    ...reactive,
    attempts: 3,
  }), false);
});

test("preserves only a live exact committed reactive engagement", () => {
  const committed = {
    commitOnceEngaged: true,
    exactTargetAlreadyEngaged: true,
    targetStatus: 1,
    targetHpPercent: 50,
  };
  assert.equal(shouldPreserveCommittedEngagement(committed), true);
  assert.equal(shouldPreserveCommittedEngagement({
    ...committed,
    targetStatus: 3,
  }), false);
  assert.equal(shouldPreserveCommittedEngagement({
    ...committed,
    commitOnceEngaged: false,
  }), false);
});

test("skips pre-combat recovery when the exact selected target is engaged", () => {
  assert.equal(shouldSkipPreCombatRecovery({
    explicitlySkipped: false,
    exactTargetSelected: true,
    targetStatus: 1,
  }), true);
  assert.equal(shouldSkipPreCombatRecovery({
    explicitlySkipped: true,
    exactTargetSelected: false,
    targetStatus: 0,
  }), true);
  assert.equal(shouldSkipPreCombatRecovery({
    explicitlySkipped: false,
    exactTargetSelected: true,
    targetStatus: 0,
  }), false);
  assert.equal(shouldSkipPreCombatRecovery({
    explicitlySkipped: false,
    exactTargetSelected: false,
    targetStatus: 1,
  }), false);
});

test("admits even matches only through the explicit healthy-Trust override", () => {
  const evenMatch = {
    verdict: "unsafe",
    difficulty: "even_match",
    allowEvenMatchWithTrusts: true,
    healthySupportCount: 2,
  };
  assert.equal(isCombatCheckApproved(evenMatch), true);
  assert.equal(isCombatCheckApproved({
    ...evenMatch,
    allowEvenMatchWithTrusts: false,
  }), false);
  assert.equal(isCombatCheckApproved({
    ...evenMatch,
    healthySupportCount: 1,
  }), false);
  assert.equal(isCombatCheckApproved({
    ...evenMatch,
    difficulty: "tough",
    healthySupportCount: 3,
  }), false);
  assert.equal(isCombatCheckApproved({
    verdict: "unsafe",
    difficulty: "tough",
    allowEngagedToughWithTrusts: true,
    exactTargetAlreadyEngaged: true,
    healthySupportCount: 2,
  }), true);
  assert.equal(isCombatCheckApproved({
    verdict: "unsafe",
    difficulty: "tough",
    allowEngagedToughWithTrusts: true,
    exactTargetAlreadyEngaged: false,
    healthySupportCount: 2,
  }), false);
  assert.equal(isCombatCheckApproved({
    verdict: "unsafe",
    difficulty: "very_tough",
    allowEngagedToughWithTrusts: true,
    exactTargetAlreadyEngaged: true,
    healthySupportCount: 3,
  }), false);
  assert.equal(isCombatCheckApproved({
    verdict: "caution",
    difficulty: "decent_challenge",
    allowCaution: true,
  }), true);
});

test("uses a weapon skill only after exact-target engagement with sufficient TP", () => {
  const ready = {
    configured: true,
    engagementObserved: true,
    exactTargetSelected: true,
    tp: 1000,
    targetHpPercent: 50,
    now: 6000,
    lastAttemptAt: 0,
  };
  assert.equal(shouldUseWeaponSkill(ready), true);
  assert.equal(shouldUseWeaponSkill({ ...ready, engagementObserved: false }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, exactTargetSelected: false }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, tp: 999 }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, targetHpPercent: 9 }), false);
  assert.equal(shouldUseWeaponSkill({ ...ready, now: 4000 }), false);
});
