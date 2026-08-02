#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { selectReactiveThreat } from "../src/reactive-combat-policy.mjs";
import { selectQuestDropTarget } from "../src/quest-drop-policy.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
const confirmation = "FARM EXACT PRIVATE SERVER QUEST DROP";
const quadavFetichNames = [
  "Amber Quadav",
  "Greater Quadav",
  "Old Quadav",
  "Veteran Quadav",
  "Brass Quadav",
];
const quadavFetichProfile = (label) => ({
  zone_id: 143,
  names: quadavFetichNames,
  preferred_names: ["Brass Quadav"],
  label,
});
const profiles = new Map([
  [534, {
    zone_id: 191,
    names: ["Wadi Hare"],
    label: "Gausebit Grass",
    weapon_skill: "Fast Blade",
    relocation_delay_ms: 1800,
    skip_known_safe_check: true,
    stop_distance: 1,
    recovery_timeout_seconds: 150,
    teleport_to_target: true,
    camps: [
      { x: -282, y: 19, z: 4 },
      { x: -251.779, y: 44.743, z: 4.286 },
      { x: -223.276, y: 23.259, z: 3.596 },
      { x: -331.563, y: 45.812, z: 2.556 },
      { x: -290, y: 34, z: 4 },
      { x: -310.947, y: 16.451, z: 4.268 },
      { x: -323.249, y: -5.855, z: 3.932 },
      { x: -324.605, y: 46.643, z: 2.908 },
    ],
  }],
  [537, { zone_id: 103, names: ["Damselfly"], label: "Damselfly Worm" }],
  [538, { zone_id: 103, names: ["Ghoul"], label: "Magicked Skull" }],
  [539, { zone_id: 103, names: ["Snipper"], label: "Crab Apron" }],
  [606, quadavFetichProfile("Quadav Fetich Head")],
  [607, quadavFetichProfile("Quadav Fetich Torso")],
  [608, quadavFetichProfile("Quadav Fetich Arms")],
  [609, quadavFetichProfile("Quadav Fetich Legs")],
  [4362, { zone_id: 120, names: ["Hill Lizard"], label: "Lizard Egg" }],
  [9082, {
    zone_id: 108,
    names: ["Huge Wasp"],
    label: "Bee Pollen",
    weapon_skill: "Fast Blade",
    camps: [
      { x: 348, y: 46, z: 9 },
      { x: 223, y: 55, z: 17 },
      { x: 234, y: 31, z: 16 },
      { x: 327, y: 6, z: 1 },
      { x: 421, y: 50, z: 3 },
      { x: 321, y: 189, z: 24 },
      { x: 241, y: 141, z: 24 },
      { x: 356, y: 106, z: 17 },
      { x: 281, y: 109, z: 24 },
      { x: 503, y: 185, z: 15 },
    ],
  }],
]);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function integerArgument(name, fallback, minimum, maximum) {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

const itemId = integerArgument("--item-id", "", 1, 65534);
const profile = profiles.get(itemId);
const maximumFights = integerArgument("--maximum-fights", "12", 1, 30);
const maximumSeconds = integerArgument("--maximum-seconds", "900", 30, 1800);
const scanRadius = integerArgument("--scan-radius", "30", 5, 40);
const minimumStartHp = integerArgument("--minimum-start-hp-percent", "75", 50, 100);
const targetCount = integerArgument("--target-count", "1", 1, 12);
if (!profile) {
  throw new Error(
    "--item-id must be a pinned quest drop: 534, 537-539, 606-609, 4362, or 9082.",
  );
}
if (argument("--confirmation") !== confirmation) {
  throw new Error(`Quest-drop farming requires --confirmation "${confirmation}".`);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-quest-drop-farm",
  version: "0.1.0",
});
const metadata = JSON.parse(await fs.readFile(
  path.join(projectDir, "runtime", "mob-metadata", `zone-${profile.zone_id}.json`),
  "utf8",
)).mobs;
const cooldowns = new Map();
const startedAt = Date.now();
const results = [];
let nextCampIndex = 0;

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(`${name} failed.`);
  return valueOf(response);
}

async function observe() {
  return call("ffxi_observe", {
    radius: scanRadius,
    max_entities: 64,
    event_limit: 20,
  });
}

async function state() {
  return call("ffxi_character_state", {
    inventory_container: 0,
    max_items: 80,
    include_recasts: false,
  });
}

async function relocateToNextCamp() {
  if (!profile.camps?.length) return false;
  const camp = profile.camps[nextCampIndex % profile.camps.length];
  nextCampIndex += 1;
  await call("ffxi_enable_control", {
    confirmation: "ENABLE PRIVATE SERVER CONTROL",
  });
  await call("ffxi_service_teleport", {
    ...camp,
    zone_id: profile.zone_id,
    reason: "combat_position",
    confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
  });
  await new Promise((resolve) => setTimeout(
    resolve,
    profile.relocation_delay_ms || 1800,
  ));
  return true;
}

async function positionAtTarget(target) {
  if (!profile.teleport_to_target || !target?.position) return false;
  await call("ffxi_enable_control", {
    confirmation: "ENABLE PRIVATE SERVER CONTROL",
  });
  await call("ffxi_service_teleport", {
    x: target.position.x,
    y: target.position.y,
    z: target.position.z,
    zone_id: profile.zone_id,
    reason: "combat_position",
    confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  return true;
}

function itemCount(characterState) {
  return (characterState.inventory?.items || [])
    .filter((item) => Number(item.item_id) === itemId)
    .reduce((total, item) => total + Number(item.count || 0), 0);
}

function activeCooldowns() {
  const now = Date.now();
  return new Set(
    [...cooldowns.entries()]
      .filter(([, until]) => until > now)
      .map(([serverId]) => serverId),
  );
}

async function runCombat(target, { reactive = false } = {}) {
  const args = [
    path.join(projectDir, "scripts", "mcp-combat.mjs"),
    "--target", target.name,
    "--server-id", String(target.server_id),
    "--max-start-distance", String(Math.min(40, Math.max(8, Math.ceil(target.distance + 2)))),
    "--stop-distance", String(profile.stop_distance || 3),
    "--approach-timeout", "20",
    "--combat-timeout", "180",
    "--recovery-timeout", String(profile.recovery_timeout_seconds || 60),
    "--minimum-start-hp-percent", String(reactive ? 50 : minimumStartHp),
    "--minimum-hp-percent", "30",
    "--weapon-skill", profile.weapon_skill || "Combo",
    "--allow-caution",
    "--allow-even-match-with-trusts",
    "--commit-once-engaged",
    ...(profile.skip_known_safe_check ? ["--skip-known-safe-check"] : []),
    ...(reactive ? [
      "--skip-recovery",
      "--allow-engaged-tough-with-trusts",
    ] : []),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectDir,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Combat process stopped by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

let reason = "maximum_fights";
try {
  await client.connect(transport);
  const initialState = await state();
  if (itemCount(initialState) >= targetCount) {
    reason = "item_already_present";
  } else {
    for (let fight = 1; fight <= maximumFights; fight += 1) {
      if (Date.now() - startedAt >= maximumSeconds * 1000) {
        reason = "time_limit";
        break;
      }
      const [observation, loopState] = await Promise.all([observe(), state()]);
      const player = observation.party?.find((member) => member.slot === 0);
      if (
        observation.login_status !== 2
        || Number(player?.zone_id) !== profile.zone_id
        || loopState.menu_open
      ) {
        throw new Error("Quest-drop loop requires the expected zone and closed menus.");
      }
      const partyIds = new Set(
        (observation.party || []).map((member) => Number(member.server_id)),
      );
      const threat = selectReactiveThreat(observation, { maxDistance: 20 });
      const target = threat || selectQuestDropTarget({
        observation,
        metadata,
        itemId,
        allowedNames: profile.names,
        preferredNames: profile.preferred_names,
        playerLevel: Number(player.main_job_level),
        radius: scanRadius,
        excludedServerIds: activeCooldowns(),
      });
      if (!target) {
        if (await relocateToNextCamp()) {
          fight -= 1;
          continue;
        }
        reason = "no_exact_target";
        break;
      }
      if (partyIds.has(Number(target.server_id))) {
        throw new Error("Party members cannot be quest-drop targets.");
      }
      const reactive = Boolean(threat);
      if (!reactive) await positionAtTarget(target);
      const code = await runCombat(target, { reactive });
      results.push({
        fight,
        server_id: target.server_id,
        name: target.name,
        reactive,
        exit_code: code,
      });
      if (code !== 0) {
        cooldowns.set(Number(target.server_id), Date.now() + 30_000);
        if (reactive) {
          reason = "reactive_combat_failed";
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const after = await state();
      if (itemCount(after) >= targetCount) {
        reason = "required_item_obtained";
        break;
      }
    }
  }
  const finalState = await state();
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    item_id: itemId,
    item_name: profile.label,
    target_count: targetCount,
    reason,
    obtained: itemCount(finalState) >= targetCount,
    final_count: itemCount(finalState),
    fights: results,
  }, null, 2));
  if (reason !== "required_item_obtained" && reason !== "item_already_present") {
    process.exitCode = 1;
  }
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close().catch(() => {});
}
