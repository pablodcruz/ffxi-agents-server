import assert from "node:assert/strict";
import test from "node:test";
import {
  selectReadyJobAbility,
  supportedMonkAbilities,
} from "../src/job-ability-policy.mjs";

test("monk rotation unlocks safe repeatable abilities by level", () => {
  const now = 1_000_000;
  const common = {
    mainJobId: 2,
    playerHpPercent: 100,
    inCombat: true,
    targetHpPercent: 80,
    lastUsedAt: new Map(),
    lastAnyAbilityAt: 0,
    now,
  };
  assert.equal(
    selectReadyJobAbility({ ...common, mainJobLevel: 5 })?.name,
    "Boost",
  );
  assert.equal(
    selectReadyJobAbility({ ...common, mainJobLevel: 15 })?.name,
    "Dodge",
  );
  assert.equal(
    selectReadyJobAbility({
      ...common,
      mainJobLevel: 25,
      lastUsedAt: new Map([["Dodge", now]]),
    })?.name,
    "Focus",
  );
});

test("chakra is health-gated and emergency two-hour abilities are excluded", () => {
  assert.equal(
    supportedMonkAbilities().some((ability) => ability.name === "Hundred Fists"),
    false,
  );
  assert.equal(
    selectReadyJobAbility({
      mainJobId: 2,
      mainJobLevel: 35,
      playerHpPercent: 65,
      inCombat: true,
      targetHpPercent: 80,
      lastUsedAt: new Map(),
      lastAnyAbilityAt: 0,
      now: 1_000_000,
    })?.name,
    "Chakra",
  );
  assert.notEqual(
    selectReadyJobAbility({
      mainJobId: 2,
      mainJobLevel: 35,
      playerHpPercent: 90,
      inCombat: true,
      targetHpPercent: 80,
      lastUsedAt: new Map(),
      lastAnyAbilityAt: 0,
      now: 1_000_000,
    })?.name,
    "Chakra",
  );
});

test("rotation requires live monk combat and honors the global action gap", () => {
  const common = {
    mainJobId: 2,
    mainJobLevel: 22,
    playerHpPercent: 100,
    inCombat: true,
    targetHpPercent: 80,
    lastUsedAt: new Map([["Dodge", 900_000]]),
    lastAnyAbilityAt: 999_000,
    now: 1_000_000,
  };
  assert.equal(selectReadyJobAbility(common), null);
  assert.equal(selectReadyJobAbility({
    ...common,
    lastAnyAbilityAt: 0,
    inCombat: false,
  }), null);
  assert.equal(selectReadyJobAbility({
    ...common,
    lastAnyAbilityAt: 0,
    mainJobId: 1,
  }), null);
});
