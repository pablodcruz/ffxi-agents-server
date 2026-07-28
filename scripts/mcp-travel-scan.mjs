#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createTravelCache,
  markTravelNodeRegistered,
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
const radius = Number(argument("--radius", "50"));
const verifiedServerIdArgument = argument("--verified-server-id");
const verifiedServerId = verifiedServerIdArgument === undefined
  ? undefined
  : Number(verifiedServerIdArgument);
const verification = argument("--verification");
const cachePath = path.resolve(
  argument("--cache", path.join(projectDir, "runtime", "travel-nodes.json")),
);

if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
  throw new Error("--radius must be from 1 through 50.");
}
if (
  verifiedServerId !== undefined
  && (!Number.isInteger(verifiedServerId) || verifiedServerId <= 0)
) {
  throw new Error("--verified-server-id must be a positive integer.");
}
if ((verifiedServerId === undefined) !== (verification === undefined)) {
  throw new Error("--verified-server-id and --verification must be supplied together.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-travel-scan", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function readCache() {
  try {
    return validateTravelCache(JSON.parse(await fs.readFile(cachePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return createTravelCache();
    throw error;
  }
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
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: {
      agent_id: agentId,
      radius,
      max_entities: 64,
      event_limit: 10,
    },
  });
  if (response.isError) throw new Error("FFXI travel-node observation failed.");
  const observation = valueOf(response);
  const player = observation.party?.find((member) => member.slot === 0);
  const zoneId = Number(player?.zone_id);
  if (!Number.isInteger(zoneId)) {
    throw new Error("The live observation did not include the player's zone.");
  }

  const cache = await readCache();
  const discovered = updateTravelCache(cache, {
    agentId,
    zoneId,
    observedAt: observation.observed_at
      ? observation.observed_at * 1000
      : Date.now(),
    entities: observation.nearby_entities,
  });

  let verified = null;
  if (verifiedServerId !== undefined) {
    const node = discovered.find(({ server_id }) => server_id === verifiedServerId)
      || Object.values(cache.nodes).find((entry) => (
        entry.agent_id === agentId && entry.server_id === verifiedServerId
      ));
    if (!node) {
      throw new Error(
        `Verified server ID ${verifiedServerId} is not present in the travel cache.`,
      );
    }
    verified = markTravelNodeRegistered(cache, node.key, { verification });
  }

  await writeCache(cache);
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mode: "read-only-travel-scan",
    cache_path: cachePath,
    agent_id: agentId,
    zone_id: zoneId,
    discovered,
    verified,
    route_eligible: routeEligibleTravelNodes(cache, { agentId }),
  }, null, 2));
} finally {
  await client.close();
}
