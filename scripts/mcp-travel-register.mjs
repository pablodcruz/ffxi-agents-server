#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  markTravelNodeInteractionCompleted,
  markTravelNodeRegistered,
  registrationEvidence,
  routeEligibleTravelNodes,
  updateTravelCache,
  validateTravelCache,
} from "../src/travel-nodes.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const agentId = argument("--agent-id", process.env.FFXI_DEFAULT_AGENT || "primary");
const maxDistance = Number(argument("--max-distance", "6"));
const cachePath = path.resolve(
  argument("--cache", path.join(projectDir, "runtime", "travel-nodes.json")),
);

if (!Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 6) {
  throw new Error("--max-distance must be from 1 through 6.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-travel-register",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: {
      agent_id: agentId,
      radius: 12,
      max_entities: 32,
      event_limit: 30,
    },
  });
  if (response.isError) throw new Error("FFXI travel-node observation failed.");
  return valueOf(response);
}

async function state() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      agent_id: agentId,
      include_recasts: false,
    },
  });
  if (response.isError) throw new Error("FFXI character-state observation failed.");
  return valueOf(response);
}

async function writeCache(cache) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporaryPath, cachePath);
}

try {
  await client.connect(transport);
  const cache = validateTravelCache(JSON.parse(await fs.readFile(cachePath, "utf8")));
  const before = await observe();
  const beforeState = await state();
  const player = before.party?.find((member) => member.slot === 0);
  const zoneId = Number(player?.zone_id);
  if (
    before.login_status !== 2
    || before.player?.status !== 0
    || beforeState.menu_open
    || !Number.isInteger(zoneId)
  ) {
    throw new Error(
      "Nearby travel registration requires an idle, logged-in character with no open menu.",
    );
  }

  const discovered = updateTravelCache(cache, {
    agentId,
    zoneId,
    observedAt: before.observed_at * 1000,
    entities: before.nearby_entities,
  });
  const candidates = discovered
    .filter((node) => (
      node.safe_auto_registration
      && node.registration_state !== "registered"
      && node.last_observed_distance <= maxDistance
    ))
    .sort((left, right) => (
      left.last_observed_distance - right.last_observed_distance
    ));
  const results = [];

  for (const node of candidates) {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: {
        agent_id: agentId,
        confirmation: "ENABLE PRIVATE SERVER CONTROL",
      },
    });
    if (enable.isError) throw new Error("Could not enable travel registration control.");
    await client.callTool({
      name: "ffxi_clear_target",
      arguments: { agent_id: agentId },
    });
    const target = await client.callTool({
      name: "ffxi_target_entity",
      arguments: {
        agent_id: agentId,
        server_id: node.server_id,
        name: node.name,
        max_distance: maxDistance,
      },
    });
    if (target.isError) throw new Error(`Could not target ${node.name}.`);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const interactionStartedAt = Math.floor(Date.now() / 1000);
    const interaction = await client.callTool({
      name: "ffxi_interact",
      arguments: {
        agent_id: agentId,
        mode: "target",
        server_id: node.server_id,
        name: node.name,
        max_distance: maxDistance,
      },
    });
    if (interaction.isError) throw new Error(`Could not interact with ${node.name}.`);
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const after = await observe();
    const afterState = await state();
    const evidence = registrationEvidence(node, after.recent_events, {
      since: interactionStartedAt,
    });
    markTravelNodeInteractionCompleted(cache, node.key);
    if (evidence) {
      markTravelNodeRegistered(cache, node.key, {
        verification: `agentbridge:system-event:${evidence.mode}`,
      });
    }

    if (afterState.menu_open) {
      await client.callTool({
        name: "ffxi_menu_input",
        arguments: { agent_id: agentId, action: "cancel" },
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: { agent_id: agentId },
    });
    results.push({
      node: cache.nodes[node.key],
      evidence,
      menu_was_closed: Boolean(afterState.menu_open),
    });
  }

  await writeCache(cache);
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mode: "guarded-nearby-travel-registration",
    agent_id: agentId,
    zone_id: zoneId,
    candidates: candidates.length,
    results,
    route_eligible: routeEligibleTravelNodes(cache, { agentId }),
  }, null, 2));
} finally {
  await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: { agent_id: agentId },
  }).catch(() => {});
  await client.close();
}
