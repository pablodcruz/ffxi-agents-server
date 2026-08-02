#!/usr/bin/env node

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { planNavmeshPath, subdividePath } from "../src/navmesh-planner.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
const meshPath = path.join(projectDir, "runtime", "navmeshes", "Batallia_Downs.nav");
const route = [
  { name: "food_1", x: 198, y: -41, z: 11 },
  { name: "food_2", x: 65, y: 146, z: 4 },
  { name: "food_3", x: 78, y: -198, z: 4 },
  { name: "food_4", x: -42.5, y: -37.5, z: -4 },
  { name: "food_5", x: -14, y: 294, z: 4 },
  { name: "syrillia", x: -512.4, y: 207.16, z: -16 },
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-raptor-trial", version: "0.1.0" });
const valueOf = (response) => response.structuredContent || response.content;

async function observe() {
  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 12, max_entities: 8, event_limit: 20 },
  });
  if (response.isError) throw new Error("Could not observe the Raptor trial.");
  return valueOf(response);
}

async function moveSegment(x, y) {
  const response = await client.callTool({
    name: "ffxi_move_to_position",
    arguments: {
      x,
      y,
      max_start_distance: 100,
      stop_distance: 1.5,
      timeout_seconds: 20,
      stuck_seconds: 4,
    },
  });
  if (response.isError) throw new Error(`Movement segment was rejected: ${JSON.stringify(valueOf(response))}`);
  const deadline = Date.now() + 20500;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const live = await observe();
    if (live.login_status !== 2 || !live.player) throw new Error("Game session was lost during the Raptor trial.");
    if (live.player.status !== 85) throw new Error(`Raptor trial mount ended with status ${live.player.status}.`);
    if (!live.control?.movement) return live;
  }
  throw new Error("Movement segment exceeded its bounded timeout.");
}

try {
  await client.connect(transport);
  const initial = await observe();
  if (initial.login_status !== 2 || initial.party?.[0]?.zone_id !== 105 || initial.player?.status !== 85) {
    throw new Error("Raptor route requires the active mounted trial in Batallia Downs (zone 105).\n");
  }
  const enabled = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enabled.isError) throw new Error("Could not arm private-server control.");

  const visits = [];
  for (const destination of route) {
    let live = await observe();
    const rawPath = await planNavmeshPath({
      meshPath,
      start: live.player.position,
      end: destination,
    });
    const waypoints = subdividePath(rawPath, 25).slice(1);
    for (const waypoint of waypoints) {
      live = await moveSegment(waypoint.x, waypoint.y);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    live = await observe();
    visits.push({
      name: destination.name,
      position: live.player.position,
      recent_events: live.recent_events?.slice(-5),
    });
  }
  console.log(JSON.stringify({ protocol: "mcp-stdio", visits }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_stop_movement", arguments: {} }).catch(() => {});
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close();
}
