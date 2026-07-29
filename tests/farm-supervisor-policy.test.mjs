import assert from "node:assert/strict";
import test from "node:test";
import {
  canCompleteCooperativeStop,
  canStopAtFightLimit,
  classifyReactiveTiming,
  excludedCombatPocket,
  hasLiveCombat,
  isClosedMenuInputRace,
  isFarmCheckApproved,
  latestLineOfSightFailure,
  lineOfSightNudgeDestination,
  parseCombatRewards,
  playerDefeated,
  readyTrustSupport,
  relocationMaximumLevelOffset,
  safeCombatPosition,
  selectProactiveTarget,
  selectRelocationCamp,
  selectTrustedCampSweepTarget,
  shouldAutoCancelMenu,
  shouldReissueReactiveAttack,
  shouldRetryRecoveryCommand,
  shouldWaitForLevelProgress,
  targetDefeated,
} from "../src/farm-supervisor-policy.mjs";

test("trusted camp sweep admits ordinary level-bounded mobs without per-pull checks", () => {
  const sweepMetadata = [
    {
      server_id: 201,
      name: "Snipper",
      maximum_level: 22,
      mob_type: 0,
    },
    {
      server_id: 202,
      name: "Thread Leech",
      maximum_level: 22,
      mob_type: 0,
      aggro: true,
      links: true,
    },
    {
      server_id: 203,
      name: "Land Worm",
      maximum_level: 20,
      mob_type: 0,
    },
    {
      server_id: 204,
      name: "Special NM",
      maximum_level: 20,
      mob_type: 2,
    },
  ];
  const observed = {
    player: { position: { x: 0, y: 0, z: 0 } },
    nearby_entities: [
      {
        server_id: 202,
        name: "Thread Leech",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 3,
        position: { x: 3, y: 0, z: 0 },
      },
      {
        server_id: 201,
        name: "Snipper",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 5,
        position: { x: 5, y: 0, z: 0 },
      },
      {
        server_id: 203,
        name: "Land Worm",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 1,
        position: { x: 1, y: 0, z: 0 },
      },
      {
        server_id: 204,
        name: "Special NM",
        entity_type: 2,
        status: 0,
        hp_percent: 100,
        distance: 2,
        position: { x: 2, y: 0, z: 0 },
      },
    ],
  };

  assert.equal(
    selectTrustedCampSweepTarget({
      observation: observed,
      metadata: sweepMetadata,
      playerLevel: 21,
    })?.server_id,
    202,
  );
  assert.equal(
    selectTrustedCampSweepTarget({
      observation: observed,
      metadata: sweepMetadata.map((mob) => (
        mob.server_id === 202 ? { ...mob, maximum_level: 23 } : mob
      )),
      playerLevel: 21,
    })?.server_id,
    201,
  );
});

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

test("selects a dense level-appropriate relocation camp away from aggro", () => {
  const camp = selectRelocationCamp({
    metadata: [
      {
        server_id: 201,
        zone_id: 108,
        name: "Mad Sheep",
        minimum_level: 13,
        maximum_level: 14,
        aggro: false,
        spawn: { x: 100, y: 100, z: 5 },
      },
      {
        server_id: 202,
        zone_id: 108,
        name: "Mad Sheep",
        minimum_level: 13,
        maximum_level: 14,
        aggro: false,
        spawn: { x: 115, y: 100, z: 5 },
      },
      {
        server_id: 203,
        zone_id: 108,
        name: "Mad Sheep",
        minimum_level: 13,
        maximum_level: 14,
        aggro: false,
        spawn: { x: 300, y: 300, z: 5 },
      },
      {
        server_id: 301,
        zone_id: 108,
        name: "Goblin Ambusher",
        minimum_level: 15,
        maximum_level: 16,
        aggro: true,
        spawn: { x: 335, y: 300, z: 5 },
      },
      {
        server_id: 401,
        zone_id: 108,
        name: "Mad Sheep",
        minimum_level: 16,
        maximum_level: 17,
        aggro: false,
        spawn: { x: 500, y: 500, z: 5 },
      },
      {
        server_id: 501,
        zone_id: 109,
        name: "Goblin Ambusher",
        minimum_level: 15,
        maximum_level: 16,
        aggro: true,
        spawn: { x: 101, y: 100, z: 5 },
      },
    ],
    playerLevel: 15,
    zoneId: 108,
    currentPosition: { x: 0, y: 0, z: 5 },
  });
  assert.equal(camp.server_id, 201);
  assert.equal(camp.cluster_size, 2);
  assert.deepEqual(camp.cluster_server_ids, [201, 202]);
  assert.ok(camp.nearest_aggro_distance > 300);
});

test("relocation camps respect cooldowns and the level band", () => {
  const camp = selectRelocationCamp({
    metadata: [
      {
        server_id: 201,
        zone_id: 108,
        name: "Mad Sheep",
        minimum_level: 13,
        maximum_level: 14,
        aggro: false,
        spawn: { x: 100, y: 100, z: 5 },
      },
      {
        server_id: 202,
        zone_id: 108,
        name: "Mad Sheep",
        minimum_level: 10,
        maximum_level: 11,
        aggro: false,
        spawn: { x: 200, y: 200, z: 5 },
      },
    ],
    playerLevel: 15,
    zoneId: 108,
    currentPosition: { x: 0, y: 0, z: 5 },
    excludedServerIds: new Set([201]),
  });
  assert.equal(camp, null);
});

test("selects a cross-zone camp without comparing unrelated coordinates", () => {
  const camp = selectRelocationCamp({
    metadata: [
      {
        server_id: 601,
        zone_id: 103,
        name: "Sand Hare",
        minimum_level: 16,
        maximum_level: 17,
        aggro: false,
        spawn: { x: 500, y: 300, z: -16 },
      },
      {
        server_id: 602,
        zone_id: 103,
        name: "Sand Hare",
        minimum_level: 16,
        maximum_level: 17,
        aggro: false,
        spawn: { x: 510, y: 300, z: -16 },
      },
      {
        server_id: 603,
        zone_id: 103,
        name: "Goblin Ambusher",
        minimum_level: 17,
        maximum_level: 20,
        aggro: true,
        spawn: { x: 570, y: 300, z: -16 },
      },
    ],
    playerLevel: 18,
    zoneId: 103,
    currentPosition: null,
    allowedNames: ["Sand Hare"],
  });
  assert.equal(camp.server_id, 601);
  assert.equal(camp.cluster_size, 2);
  assert.equal(camp.travel_distance, null);
  assert.equal(camp.nearest_aggro_distance, 70);
});

test("admits at-level transition metadata only with an explicit offset", () => {
  const metadata = [
    {
      server_id: 701,
      zone_id: 103,
      name: "Sand Hare",
      minimum_level: 16,
      maximum_level: 17,
      aggro: false,
      spawn: { x: 500, y: 300, z: -16 },
    },
  ];
  assert.equal(selectRelocationCamp({
    metadata,
    playerLevel: 17,
    zoneId: 103,
    currentPosition: null,
    allowedNames: ["Sand Hare"],
  }), null);
  assert.equal(selectRelocationCamp({
    metadata,
    playerLevel: 17,
    zoneId: 103,
    currentPosition: null,
    allowedNames: ["Sand Hare"],
    maximumLevelOffset: 0,
  })?.server_id, 701);
});

test("opts only the Valkurm level-17 transition band into at-level metadata", () => {
  assert.equal(relocationMaximumLevelOffset({
    zoneId: 103,
    playerLevel: 17,
  }), 0);
  assert.equal(relocationMaximumLevelOffset({
    zoneId: 103,
    playerLevel: 18,
  }), -1);
  assert.equal(relocationMaximumLevelOffset({
    zoneId: 103,
    playerLevel: 16,
  }), -1);
  assert.equal(relocationMaximumLevelOffset({
    zoneId: 108,
    playerLevel: 17,
  }), -1);
});

test("holds proactive scouting while a defeated target's rewards settle", () => {
  assert.equal(shouldWaitForLevelProgress({
    dirty: true,
    now: 1_000,
    nextAttemptAt: 3_000,
  }), true);
  assert.equal(shouldWaitForLevelProgress({
    dirty: true,
    now: 3_000,
    nextAttemptAt: 3_000,
  }), false);
  assert.equal(shouldWaitForLevelProgress({
    dirty: false,
    now: 1_000,
    nextAttemptAt: 3_000,
  }), false);
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

test("recognizes only the closed-menu input race as a safe cancel no-op", () => {
  assert.equal(isClosedMenuInputRace(
    new Error(
      "ffxi_menu_input failed: Confirm, cancel, up, down, left, and right require an open menu or dialogue.",
    ),
  ), true);
  assert.equal(isClosedMenuInputRace(
    new Error("ffxi_menu_input failed: Agent writes are disabled."),
  ), false);
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

test("cooperative stops require a stable idle window after combat drains", () => {
  const idle = observation({ player: { status: 0, hp_percent: 90 } });
  const fighting = observation({ player: { status: 1, hp_percent: 90 } });
  assert.equal(canCompleteCooperativeStop({
    stopRequested: true,
    observation: idle,
    currentTarget: null,
    reactiveThreat: null,
    idleSamples: 8,
  }), true);
  assert.equal(canCompleteCooperativeStop({
    stopRequested: true,
    observation: idle,
    currentTarget: { server_id: 42 },
    reactiveThreat: null,
    idleSamples: 8,
  }), false);
  assert.equal(canCompleteCooperativeStop({
    stopRequested: true,
    observation: fighting,
    currentTarget: null,
    reactiveThreat: { server_id: 42 },
    idleSamples: 8,
  }), false);
  assert.equal(canCompleteCooperativeStop({
    stopRequested: true,
    observation: idle,
    currentTarget: null,
    reactiveThreat: null,
    idleSamples: 7,
  }), false);
  assert.equal(canCompleteCooperativeStop({
    stopRequested: false,
    observation: idle,
    currentTarget: null,
    reactiveThreat: null,
    idleSamples: 20,
  }), false);
});

test("farm checks admit only a clean decent challenge when explicitly opted in", () => {
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "safe",
      difficulty: "easy_prey",
      high_defense: false,
      high_evasion: false,
    },
  }), true);
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "caution",
      difficulty: "decent_challenge",
      high_defense: false,
      high_evasion: false,
    },
    allowCaution: false,
  }), false);
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "caution",
      difficulty: "decent_challenge",
      high_defense: false,
      high_evasion: false,
    },
    allowCaution: true,
  }), true);
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "caution",
      difficulty: "decent_challenge",
      high_defense: true,
      high_evasion: false,
    },
    allowCaution: true,
  }), false);
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "caution",
      difficulty: "decent_challenge",
      high_defense: true,
      high_evasion: false,
    },
    allowCaution: true,
    trustedSupportReady: true,
  }), true);
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "caution",
      difficulty: "decent_challenge",
      high_defense: true,
      high_evasion: true,
    },
    allowCaution: true,
    trustedSupportReady: true,
  }), false);
  assert.equal(isFarmCheckApproved({
    checkVerdict: {
      verdict: "unsafe",
      difficulty: "even_match",
      high_defense: false,
      high_evasion: false,
    },
    allowCaution: true,
  }), false);
});

test("recognizes multiple healthy in-zone Trust companions as combat support", () => {
  assert.deepEqual(readyTrustSupport({
    party: [
      { name: "Pablo", hp_percent: 100, zone_id: 108 },
      { name: "Valaineral", hp_percent: 100, zone_id: 108 },
      { name: "MihliAliapoh", hp_percent: 90, zone_id: 108 },
      { name: "Joachim", hp_percent: 79, zone_id: 108 },
      { name: "Naji", hp_percent: 100, zone_id: 107 },
    ],
    playerName: "Pablo",
    zoneId: 108,
  }), {
    ready: true,
    members: ["Valaineral", "MihliAliapoh"],
  });
  assert.deepEqual(readyTrustSupport({
    party: [
      { name: "Pablo", hp_percent: 100, zone_id: 108 },
      { name: "Valaineral", hp_percent: 100, zone_id: 108 },
      { name: "MihliAliapoh", hp_percent: 70, zone_id: 108 },
    ],
    playerName: "Pablo",
    zoneId: 108,
  }), {
    ready: false,
    members: ["Valaineral"],
  });
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
