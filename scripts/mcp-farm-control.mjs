#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FARM_CONFIRMATION } from "../src/farm-supervisor-manager.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const action = argument("--action", "status");
const agentId = argument("--agent-id", "primary");
const allowCautionValue = argument("--allow-caution", "false");
const autoRelocateValue = argument("--auto-relocate", "false");
const autoTransitionValue = argument("--auto-transition", "false");
const trustedCampSweepValue = argument("--trusted-camp-sweep", "false");
const autoJobAbilitiesValue = argument("--auto-job-abilities", "false");
const nmRouteValue = argument("--nm-route", "false");
const combatSpell = argument("--combat-spell", "");
if (!["start", "status", "stop"].includes(action)) {
  throw new Error("--action must be start, status, or stop.");
}
if (!["true", "false"].includes(allowCautionValue)) {
  throw new Error("--allow-caution must be true or false.");
}
if (!["true", "false"].includes(autoRelocateValue)) {
  throw new Error("--auto-relocate must be true or false.");
}
if (!["true", "false"].includes(autoTransitionValue)) {
  throw new Error("--auto-transition must be true or false.");
}
if (!["true", "false"].includes(trustedCampSweepValue)) {
  throw new Error("--trusted-camp-sweep must be true or false.");
}
if (!["true", "false"].includes(autoJobAbilitiesValue)) {
  throw new Error("--auto-job-abilities must be true or false.");
}
if (!["true", "false"].includes(nmRouteValue)) {
  throw new Error("--nm-route must be true or false.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-farm-control",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) {
    const detail = response.content?.map((entry) => entry.text).join(" ") || "";
    throw new Error(`${name} failed${detail ? `: ${detail}` : "."}`);
  }
  return valueOf(response);
}

try {
  await client.connect(transport);
  let result;
  if (action === "start") {
    if (argument("--confirmation") !== FARM_CONFIRMATION) {
      throw new Error(
        `Farm start requires --confirmation "${FARM_CONFIRMATION}".`,
      );
    }
    result = await call("ffxi_farm_start", {
      agent_id: agentId,
      zone_id: Number(argument("--zone-id", "107")),
      maximum_seconds: Number(argument("--maximum-seconds", "900")),
      maximum_fights: Number(argument("--maximum-fights", "30")),
      scan_radius: Number(argument("--scan-radius", "50")),
      minimum_start_hp_percent: Number(
        argument("--minimum-start-hp-percent", "90"),
      ),
      allow_caution: allowCautionValue === "true",
      auto_relocate: autoRelocateValue === "true",
      auto_transition: autoTransitionValue === "true",
      target_level: Number(argument("--target-level", "0")),
      quest_item_id: Number(argument("--quest-item-id", "0")),
      trusted_camp_sweep: trustedCampSweepValue === "true",
      auto_job_abilities: autoJobAbilitiesValue === "true",
      weapon_skill: argument("--weapon-skill", "Combo"),
      combat_spell: combatSpell,
      maximum_combat_spells_per_fight: Number(
        argument("--maximum-combat-spells-per-fight", "0"),
      ),
      minimum_cast_mp_percent: Number(
        argument("--minimum-cast-mp-percent", "35"),
      ),
      nm_route: nmRouteValue === "true",
      maximum_route_rounds: Number(argument("--maximum-route-rounds", "1")),
      minimum_free_inventory_slots: Number(
        argument("--minimum-free-inventory-slots", "5"),
      ),
      confirmation: FARM_CONFIRMATION,
    });
  } else if (action === "stop") {
    const leaseId = argument("--lease-id");
    result = await call("ffxi_farm_stop", {
      agent_id: agentId,
      ...(leaseId ? { lease_id: leaseId } : {}),
    });
  } else {
    result = await call("ffxi_farm_status", { agent_id: agentId });
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close().catch(() => {});
}
