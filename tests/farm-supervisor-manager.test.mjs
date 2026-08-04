import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FARM_CONFIRMATION,
  farmRenewalConfig,
  farmStatus,
  farmSupervisorArgs,
} from "../src/farm-supervisor-manager.mjs";

test("reports an idle farm supervisor without runtime state", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-farm-"));
  context.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  assert.deepEqual(await farmStatus({ projectDir }), {
    status: "idle",
    active: false,
  });
});

test("reports fresh and stale leases without exposing the process id", async (context) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffxi-farm-"));
  context.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  const directory = path.join(projectDir, "runtime", "farm-supervisor");
  await fs.mkdir(directory, { recursive: true });
  const statePath = path.join(directory, "primary.json");
  const state = {
    lease_id: "lease-1",
    pid: 12345,
    status: "running",
    phase: "scouting",
    heartbeat_at_ms: Date.now(),
  };
  await fs.writeFile(statePath, JSON.stringify(state));

  const fresh = await farmStatus({ projectDir });
  assert.equal(fresh.active, true);
  assert.equal(fresh.pid, undefined);
  assert.ok(fresh.heartbeat_age_ms < 5000);

  await fs.writeFile(statePath, JSON.stringify({
    ...state,
    heartbeat_at_ms: Date.now() - 6000,
  }));
  const stale = await farmStatus({ projectDir });
  assert.equal(stale.active, false);
  assert.ok(stale.heartbeat_age_ms >= 5000);
});

test("passes the explicit caution opt-in to the detached supervisor process", () => {
  const args = farmSupervisorArgs({
    projectDir: "/private/test-project",
    agentId: "primary",
    leaseId: "00000000-0000-4000-8000-000000000001",
    zoneId: 108,
    maximumSeconds: 360,
    maximumFights: 3,
    scanRadius: 30,
    minimumStartHpPercent: 90,
    allowCaution: true,
    autoRelocate: true,
    autoTransition: true,
    targetLevel: 20,
    questItemId: 539,
    trustedCampSweep: true,
    maximumTargetLevelOffset: 5,
    autoJobAbilities: true,
    summonTrusts: false,
    weaponSkill: "Combo",
    combatSpell: "Fire",
    combatSpellUpgrade: "Stone II",
    combatSpellUpgradeLevel: 35,
    maximumCombatSpellsPerFight: 1,
    minimumCastMpPercent: 35,
    openingCombatSpell: "Dia II",
    minimumOpeningSpellMpPercent: 65,
    selfBuffSpell: "Enthunder",
    selfBuffIntervalSeconds: 150,
    nmRoute: true,
    maximumRouteRounds: 2,
    minimumFreeInventorySlots: 6,
  });
  assert.deepEqual(args, [
    "/private/test-project/scripts/mcp-farm-supervisor.mjs",
    "--agent-id", "primary",
    "--lease-id", "00000000-0000-4000-8000-000000000001",
    "--zone-id", "108",
    "--maximum-seconds", "360",
    "--maximum-fights", "3",
    "--scan-radius", "30",
    "--minimum-start-hp-percent", "90",
    "--minimum-start-mp-percent", "0",
    "--allow-caution", "true",
    "--auto-relocate", "true",
    "--auto-transition", "true",
    "--target-level", "20",
    "--quest-item-id", "539",
    "--trusted-camp-sweep", "true",
    "--maximum-target-level-offset", "5",
    "--auto-job-abilities", "true",
    "--summon-trusts", "false",
    "--weapon-skill", "Combo",
    "--combat-spell", "Fire",
    "--combat-spell-upgrade", "Stone II",
    "--combat-spell-upgrade-level", "35",
    "--maximum-combat-spells-per-fight", "1",
    "--minimum-cast-mp-percent", "35",
    "--opening-combat-spell", "Dia II",
    "--minimum-opening-spell-mp-percent", "65",
    "--self-buff-spell", "Enthunder",
    "--self-buff-interval-seconds", "150",
    "--nm-route", "true",
    "--maximum-route-rounds", "2",
    "--minimum-free-inventory-slots", "6",
    "--objective-target-name", "",
    "--objective-support-target-name", "",
    "--objective-kill-count", "0",
    "--confirmation", FARM_CONFIRMATION,
  ]);
});

test("passes an empty weapon skill to disable unavailable weapon-skill attempts", () => {
  const args = farmSupervisorArgs({
    projectDir: "/private/test-project",
    agentId: "primary",
    leaseId: "00000000-0000-4000-8000-000000000002",
    zoneId: 107,
    maximumSeconds: 3600,
    maximumFights: 200,
    scanRadius: 45,
    minimumStartHpPercent: 75,
    allowCaution: true,
    autoRelocate: true,
    autoTransition: true,
    targetLevel: 40,
    questItemId: 0,
    trustedCampSweep: true,
    maximumTargetLevelOffset: 1,
    autoJobAbilities: true,
    summonTrusts: true,
    weaponSkill: "",
    combatSpell: "Stone",
    maximumCombatSpellsPerFight: 1,
    minimumCastMpPercent: 35,
    nmRoute: false,
    maximumRouteRounds: 1,
    minimumFreeInventorySlots: 5,
  });

  const weaponSkillIndex = args.indexOf("--weapon-skill");
  assert.equal(args[weaponSkillIndex + 1], "");
});

test("preserves every RDM spell option across watchdog renewal", () => {
  const renewed = farmRenewalConfig({
    projectDir: "/private/test-project",
    agentId: "primary",
    farm: {
      active_zone_id: 123,
      config: {
        zone_id: 123,
        maximum_seconds: 1800,
        maximum_fights: 100,
        scan_radius: 45,
        minimum_start_hp_percent: 75,
        minimum_start_mp_percent: 60,
        allow_caution: true,
        auto_relocate: false,
        auto_transition: false,
        target_level: 40,
        quest_item_id: 0,
        trusted_camp_sweep: true,
        maximum_target_level_offset: 5,
        auto_job_abilities: true,
        summon_trusts: true,
        weapon_skill: "Fast Blade",
        combat_spell: "Thunder",
        combat_spell_upgrade: "Stone II",
        combat_spell_upgrade_level: 35,
        maximum_combat_spells_per_fight: 1,
        minimum_cast_mp_percent: 35,
        opening_combat_spell: "Dia II",
        minimum_opening_spell_mp_percent: 65,
        self_buff_spell: "Enthunder",
        self_buff_interval_seconds: 150,
        nm_route: false,
        maximum_route_rounds: 1,
        minimum_free_inventory_slots: 5,
        objective_target_name: "Argus",
        objective_support_target_name: "Leech King",
        objective_kill_count: 1,
      },
    },
  });

  assert.equal(renewed.combatSpell, "Thunder");
  assert.equal(renewed.minimumStartMpPercent, 60);
  assert.equal(renewed.combatSpellUpgrade, "Stone II");
  assert.equal(renewed.combatSpellUpgradeLevel, 35);
  assert.equal(renewed.openingCombatSpell, "Dia II");
  assert.equal(renewed.minimumOpeningSpellMpPercent, 65);
  assert.equal(renewed.selfBuffSpell, "Enthunder");
  assert.equal(renewed.selfBuffIntervalSeconds, 150);
  assert.equal(renewed.objectiveSupportTargetName, "Leech King");
  assert.equal(renewed.confirmation, FARM_CONFIRMATION);
});

test("passes a non-completing support target beside an exact objective", () => {
  const args = farmSupervisorArgs({
    projectDir: "/private/test-project",
    agentId: "primary",
    leaseId: "00000000-0000-4000-8000-000000000003",
    zoneId: 198,
    maximumSeconds: 3600,
    maximumFights: 50,
    scanRadius: 50,
    minimumStartHpPercent: 75,
    allowCaution: true,
    autoRelocate: true,
    autoTransition: false,
    targetLevel: 0,
    questItemId: 0,
    trustedCampSweep: false,
    maximumTargetLevelOffset: 5,
    autoJobAbilities: true,
    summonTrusts: true,
    weaponSkill: "Fast Blade",
    combatSpell: "Thunder",
    maximumCombatSpellsPerFight: 1,
    minimumCastMpPercent: 35,
    openingCombatSpell: "Dia II",
    minimumOpeningSpellMpPercent: 65,
    selfBuffSpell: "Enthunder",
    selfBuffIntervalSeconds: 150,
    nmRoute: false,
    maximumRouteRounds: 1,
    minimumFreeInventorySlots: 5,
    objectiveTargetName: "Argus",
    objectiveSupportTargetName: "Leech King",
    objectiveKillCount: 1,
  });
  const supportIndex = args.indexOf("--objective-support-target-name");
  assert.equal(args[supportIndex + 1], "Leech King");
  const objectiveIndex = args.indexOf("--objective-target-name");
  assert.equal(args[objectiveIndex + 1], "Argus");
});
