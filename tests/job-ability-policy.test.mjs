import assert from "node:assert/strict";
import test from "node:test";
import {
  selectReadyJobAbility,
  supportedMonkAbilities,
  supportedWarriorAbilities,
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

test("rotation requires live combat, a supported job, and the global action gap", () => {
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
    mainJobId: 3,
  }), null);
});

test("warrior rotation unlocks low-friction abilities and excludes hate tools", () => {
  const common = {
    mainJobId: 1,
    playerHpPercent: 100,
    inCombat: true,
    targetHpPercent: 80,
    lastUsedAt: new Map(),
    lastAnyAbilityAt: 0,
    now: 1_000_000,
  };
  assert.equal(
    selectReadyJobAbility({ ...common, mainJobLevel: 14 }),
    null,
  );
  assert.equal(
    selectReadyJobAbility({ ...common, mainJobLevel: 15 })?.name,
    "Berserk",
  );
  assert.equal(
    supportedWarriorAbilities().some((ability) => ability.name === "Provoke"),
    false,
  );
  assert.deepEqual(
    supportedWarriorAbilities().map((ability) => ability.name),
    ["Defender", "Berserk", "Warcry", "Aggressor"],
  );
});

test("warrior uses Defender only for low HP and suppresses offense there", () => {
  const common = {
    mainJobId: 1,
    mainJobLevel: 45,
    inCombat: true,
    targetHpPercent: 80,
    lastUsedAt: new Map(),
    lastAnyAbilityAt: 0,
    now: 1_000_000,
  };
  assert.equal(
    selectReadyJobAbility({
      ...common,
      playerHpPercent: 45,
    })?.name,
    "Defender",
  );
  assert.equal(
    selectReadyJobAbility({
      ...common,
      playerHpPercent: 55,
    }),
    null,
  );
  assert.equal(
    selectReadyJobAbility({
      ...common,
      playerHpPercent: 80,
      lastUsedAt: new Map([["Berserk", 1_000_000]]),
    })?.name,
    "Warcry",
  );
  assert.equal(
    selectReadyJobAbility({
      ...common,
      playerHpPercent: 80,
      lastUsedAt: new Map([
        ["Berserk", 1_000_000],
        ["Warcry", 1_000_000],
      ]),
    })?.name,
    "Aggressor",
  );
});
