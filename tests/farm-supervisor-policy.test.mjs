import assert from "node:assert/strict";
import test from "node:test";
import {
  canStopAtFightLimit,
  classifyReactiveTiming,
  excludedCombatPocket,
  hasLiveCombat,
  latestLineOfSightFailure,
  lineOfSightNudgeDestination,
  parseCombatRewards,
  playerDefeated,
  safeCombatPosition,
  selectProactiveTarget,
  shouldAutoCancelMenu,
  shouldReissueReactiveAttack,
  shouldRetryRecoveryCommand,
  targetDefeated,
} from "../src/farm-supervisor-policy.mjs";

const metadata = [
  {
    server_id: 101,
    name: "Walking Sapling",
    minimum_level: 1,
    maximum_level: 3,
    aggro: false,
    links: true,
    drops: [],
  },
  {
    server_id: 102,
    name: "Tunnel Worm",
    minimum_level: 1,
    maximum_level: 3,
    aggro: false,
    links: false,
    drops: [],
  },
];

function observation(overrides = {}) {
  return {
    player: {
      status: 0,
      position: { x: 0, y: 0, z: 0 },
    },
    nearby_entities: [],
    ...overrides,
  };
}

test("selects an approved proactive target and preserves family exclusions", () => {
  const selected = selectProactiveTarget({
    observation: observation({
      nearby_entities: [
        {
          server_id: 102,
          name: "Tunnel Worm",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 2,
          position: { x: 2, y: 0, z: 0 },
        },
        {
          server_id: 101,
          name: "Walking Sapling",
          entity_type: 2,
          status: 0,
          hp_percent: 100,
          distance: 8,
          position: { x: 8, y: 0, z: 0 },
        },
      ],
    }),
    metadata,
    playerLevel: 10,
  });
  assert.equal(selected?.server_id, 101);
});

test("refuses combat positioning whenever a live fight exists", () => {
  const target = { position: { x: 10, y: 0, z: 1 } };
  assert.equal(safeCombatPosition({
    observation: observation({ player: { status: 1, position: { x: 0, y: 0, z: 0 } } }),
    target,
  }), null);
  assert.equal(safeCombatPosition({
    observation: observation({
      nearby_entities: [{ status: 1, hp_percent: 80 }],
    }),
    target,
  }), null);
});

test("creates a four-yalm offset only while idle", () => {
  assert.deepEqual(safeCombatPosition({
    observation: observation(),
    target: { position: { x: 10, y: 0, z: 1 } },
  }), { x: 6, y: 0, z: 1 });
});

test("recognizes both observed corpse statuses and missing entities", () => {
  assert.equal(targetDefeated({ status: 1, hp_percent: 20 }), false);
  assert.equal(targetDefeated({ status: 2, hp_percent: 20 }), true);
  assert.equal(targetDefeated({ status: 3, hp_percent: 0 }), true);
  assert.equal(targetDefeated(null), true);
});

test("recognizes defeated players from HP or the dead stance", () => {
  assert.equal(playerDefeated(observation({
    player: { status: 3, hp_percent: 0 },
  })), true);
  assert.equal(playerDefeated(observation({
    player: { status: 3, hp_percent: 1 },
  })), true);
  assert.equal(playerDefeated(observation({
    player: { status: 0, hp_percent: 0 },
  })), true);
  assert.equal(playerDefeated(observation({
    player: { status: 0, hp_percent: 90 },
  })), false);
});

test("does not toggle a reactive attack off when it registered during follow", () => {
  assert.equal(shouldReissueReactiveAttack({
    observation: observation({
      player: { status: 1, hp_percent: 80 },
      target: {
        server_id: 42,
        status: 1,
        hp_percent: 100,
      },
    }),
    targetServerId: 42,
  }), false);
  assert.equal(shouldReissueReactiveAttack({
    observation: observation({
      player: { status: 0, hp_percent: 80 },
      target: {
        server_id: 42,
        status: 1,
        hp_percent: 100,
      },
    }),
    targetServerId: 42,
  }), true);
  assert.equal(shouldReissueReactiveAttack({
    observation: observation({
      player: { status: 1, hp_percent: 80 },
      target: {
        server_id: 43,
        status: 1,
        hp_percent: 100,
      },
    }),
    targetServerId: 42,
  }), true);
});

test("identifies only fresh line-of-sight failures from the system channel", () => {
  assert.deepEqual(latestLineOfSightFailure([
    { id: 10, mode: 122, message: "Unable to see the Rock Lizard.\u007f1" },
    { id: 11, mode: 28, message: "The Rock Lizard hits Pablo." },
    { id: 12, mode: 122, message: "You cannot see the Rock Lizard.\u007f1" },
  ], { afterEventId: 10 }), {
    id: 12,
    mode: 122,
    message: "You cannot see the Rock Lizard.\u007f1",
  });
  assert.equal(latestLineOfSightFailure([
    { id: 10, mode: 122, message: "Unable to attack the Rock Lizard." },
  ], { afterEventId: 9 }), null);
});

test("nudges through only a nearby live engaged target", () => {
  assert.deepEqual(lineOfSightNudgeDestination({
    player: {
      status: 1,
      position: { x: 0, y: 0 },
    },
    target: {
      status: 1,
      hp_percent: 100,
      position: { x: 0, y: 1 },
    },
  }), {
    x: 0,
    y: 3.5,
  });
  assert.equal(lineOfSightNudgeDestination({
    player: {
      status: 0,
      position: { x: 0, y: 0 },
    },
    target: {
      status: 1,
      hp_percent: 100,
      position: { x: 0, y: 1 },
    },
  }), null);
  assert.deepEqual(lineOfSightNudgeDestination({
    player: {
      status: 0,
      position: { x: 0, y: 0 },
    },
    target: {
      status: 0,
      hp_percent: 100,
      position: { x: 1, y: 0 },
    },
    requireEngaged: false,
  }), {
    x: 3.5,
    y: 0,
  });
  assert.equal(lineOfSightNudgeDestination({
    player: {
      status: 1,
      position: { x: 0, y: 0 },
    },
    target: {
      status: 1,
      hp_percent: 100,
      position: { x: 0, y: 5 },
    },
  }), null);
});

test("retries a missed recovery command only while idle and still below threshold", () => {
  assert.equal(shouldRetryRecoveryCommand({
    observation: observation({ player: { status: 0, hp_percent: 80 } }),
    minimumHpPercent: 90,
    lastCommandAt: 1000,
    now: 3000,
  }), true);
  assert.equal(shouldRetryRecoveryCommand({
    observation: observation({ player: { status: 33, hp_percent: 80 } }),
    minimumHpPercent: 90,
    lastCommandAt: 1000,
    now: 3000,
  }), false);
  assert.equal(shouldRetryRecoveryCommand({
    observation: observation({ player: { status: 0, hp_percent: 95 } }),
    minimumHpPercent: 90,
    lastCommandAt: 1000,
    now: 3000,
  }), false);
  assert.equal(shouldRetryRecoveryCommand({
    observation: observation({ player: { status: 0, hp_percent: 80 } }),
    minimumHpPercent: 90,
    lastCommandAt: 2000,
    now: 3000,
  }), false);
});

test("auto-cancels known disposable menus unless reactive defense needs it", () => {
  assert.equal(shouldAutoCancelMenu({
    menuName: "menu    inline  ",
    reactiveThreat: null,
  }), true);
  assert.equal(shouldAutoCancelMenu({
    menuName: "menu    playermo",
    reactiveThreat: null,
  }), true);
  assert.equal(shouldAutoCancelMenu({
    menuName: "menu    shopmain",
    reactiveThreat: null,
  }), false);
  assert.equal(shouldAutoCancelMenu({
    menuName: "menu    shopmain",
    reactiveThreat: { server_id: 42 },
  }), true);
});

test("separates immediate aggro latency from intentional add queue time", () => {
  assert.deepEqual(classifyReactiveTiming({
    firstSeenAt: 1000,
    now: 1450,
    handoff: false,
  }), {
    aggroResponseMs: 450,
    handoffQueueMs: null,
  });
  assert.deepEqual(classifyReactiveTiming({
    firstSeenAt: 1000,
    now: 28000,
    handoff: true,
  }), {
    aggroResponseMs: null,
    handoffQueueMs: 27000,
  });
});

test("fight limits stop only after current and reactive combat are drained", () => {
  const idle = observation({ player: { status: 0, hp_percent: 90 } });
  const fighting = observation({ player: { status: 1, hp_percent: 90 } });
  assert.equal(canStopAtFightLimit({
    fightsCompleted: 6,
    maximumFights: 6,
    observation: idle,
    currentTarget: null,
    reactiveThreat: null,
  }), true);
  assert.equal(canStopAtFightLimit({
    fightsCompleted: 6,
    maximumFights: 6,
    observation: fighting,
    currentTarget: null,
    reactiveThreat: { server_id: 42 },
  }), false);
  assert.equal(canStopAtFightLimit({
    fightsCompleted: 5,
    maximumFights: 6,
    observation: idle,
    currentTarget: null,
    reactiveThreat: null,
  }), false);
});

test("excludes the unvalidated South Gustaberg multi-aggro pocket", () => {
  assert.equal(excludedCombatPocket({
    zoneId: 107,
    position: { x: 12, y: -168 },
  })?.reason, "unvalidated_quadav_multi_aggro");
  assert.equal(excludedCombatPocket({
    zoneId: 107,
    position: { x: 60, y: -168 },
  }), null);
  assert.equal(excludedCombatPocket({
    zoneId: 106,
    position: { x: 12, y: -168 },
  }), null);
});

test("parses FFXI reward messages with trailing control bytes exactly once", () => {
  const rewards = parseCombatRewards([
    {
      id: 10,
      message: "Pablo gains 80 experience points.\u007f1",
    },
    {
      id: 11,
      message: "\u001fPablo obtains 6 gil.\u007f1",
    },
    {
      id: 12,
      message: "Naji gains 999 experience points.",
    },
  ], {
    afterEventId: 9,
    playerName: "Pablo",
  });
  assert.deepEqual(rewards, {
    last_event_id: 12,
    gil_earned: 6,
    exp_earned: 80,
  });
  assert.deepEqual(parseCombatRewards([
    { id: 11, message: "Pablo obtains 6 gil." },
  ], {
    afterEventId: 12,
    playerName: "Pablo",
  }), {
    last_event_id: 12,
    gil_earned: 0,
    exp_earned: 0,
  });
});
