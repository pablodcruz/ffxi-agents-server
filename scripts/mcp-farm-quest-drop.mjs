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
  [537, { zone_id: 103, names: ["Damselfly"], label: "Damselfly Worm" }],
  [538, { zone_id: 103, names: ["Ghoul"], label: "Magicked Skull" }],
  [539, { zone_id: 103, names: ["Snipper"], label: "Crab Apron" }],
  [606, quadavFetichProfile("Quadav Fetich Head")],
  [607, quadavFetichProfile("Quadav Fetich Torso")],
  [608, quadavFetichProfile("Quadav Fetich Arms")],
  [609, quadavFetichProfile("Quadav Fetich Legs")],
  [4362, { zone_id: 120, names: ["Hill Lizard"], label: "Lizard Egg" }],
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
if (!profile) {
  throw new Error(
    "--item-id must be a pinned quest drop: 537-539, 606-609, or 4362.",
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
    "--stop-distance", "3",
    "--approach-timeout", "20",
    "--combat-timeout", "180",
    "--minimum-start-hp-percent", String(reactive ? 50 : minimumStartHp),
    "--minimum-hp-percent", "30",
    "--weapon-skill", "Combo",
    "--allow-caution",
    "--allow-even-match-with-trusts",
    "--commit-once-engaged",
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
  if (itemCount(initialState) > 0) {
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
        reason = "no_exact_target";
        break;
      }
      if (partyIds.has(Number(target.server_id))) {
        throw new Error("Party members cannot be quest-drop targets.");
      }
      const reactive = Boolean(threat);
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
      if (itemCount(after) > 0) {
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
    reason,
    obtained: itemCount(finalState) > 0,
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
