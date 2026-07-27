#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const radiusIndex = process.argv.indexOf("--radius");
const maxEntitiesIndex = process.argv.indexOf("--max-entities");
const radius = radiusIndex >= 0 ? Number(process.argv[radiusIndex + 1]) : 40;
const maxEntities = maxEntitiesIndex >= 0
  ? Number.parseInt(process.argv[maxEntitiesIndex + 1], 10)
  : 24;

if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
  throw new Error("--radius must be a number from 1 through 50.");
}
if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > 64) {
  throw new Error("--max-entities must be an integer from 1 through 64.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-observe", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const observation = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius, max_entities: maxEntities, event_limit: 10 },
  });
  const value = valueOf(observation);

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    agent_id: value.agent_id,
    login_status: value.login_status,
    player: value.player,
    target: value.target,
    control: value.control,
    nearby_entities: value.nearby_entities,
    recent_events: value.recent_events,
  }, null, 2));

  if (observation.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
