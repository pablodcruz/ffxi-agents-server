#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const destination = {
  x: Number(argument("--x")),
  y: Number(argument("--y")),
  z: Number(argument("--z")),
};
const zoneId = Number(argument("--zone"));
const reason = argument("--reason");
const allowedReasons = new Set([
  "vendor",
  "travel_node",
  "combat_position",
  "stuck_recovery",
]);

if (Object.values(destination).some((value) => !Number.isFinite(value))) {
  throw new Error("Service teleport requires finite --x, --y, and --z coordinates.");
}
if (!Number.isInteger(zoneId) || zoneId < 0 || zoneId > 298) {
  throw new Error("Service teleport requires --zone from 0 through 298.");
}
if (!allowedReasons.has(reason)) {
  throw new Error(
    "Service teleport requires --reason vendor|travel_node|combat_position|stuck_recovery.",
  );
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-service-teleport",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const before = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 12, max_entities: 12, event_limit: 8 },
  });
  if (before.isError) throw new Error("Could not observe before service teleport.");

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const teleport = await client.callTool({
    name: "ffxi_service_teleport",
    arguments: {
      ...destination,
      zone_id: zoneId,
      reason,
      confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
    },
  });
  if (teleport.isError) {
    const detail = teleport.content
      ?.map((entry) => entry.text)
      .filter(Boolean)
      .join(" ");
    throw new Error(
      `The guarded service teleport was rejected${detail ? `: ${detail}` : "."}`,
    );
  }

  let after;
  let afterValue;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    after = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 20, max_entities: 24, event_limit: 16 },
    });
    if (after.isError) throw new Error("Could not observe after service teleport.");
    afterValue = valueOf(after);
    const position = afterValue?.player?.position;
    const playerZoneId = Number(
      afterValue?.party?.find((member) => Number(member?.slot) === 0)?.zone_id,
    );
    if (
      afterValue?.login_status === 2
      && playerZoneId === zoneId
      && position
      && Math.hypot(
        position.x - destination.x,
        position.y - destination.y,
      ) <= 3
    ) {
      break;
    }
  }
  if (!afterValue?.player?.position) {
    throw new Error(
      "Service teleport did not return a stable logged-in player observation.",
    );
  }
  const horizontalRemaining = Math.hypot(
    afterValue.player.position.x - destination.x,
    afterValue.player.position.y - destination.y,
  );
  const elevationDelta = afterValue.player.position.z - destination.z;
  const playerZoneId = Number(
    afterValue.party?.find((member) => Number(member?.slot) === 0)?.zone_id,
  );
  const applied = (
    afterValue.login_status === 2
    && playerZoneId === zoneId
    && horizontalRemaining <= 3
  );
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    reason,
    requested_destination: destination,
    zone_id: zoneId,
    applied,
    horizontal_remaining: horizontalRemaining,
    elevation_delta: elevationDelta,
    before: valueOf(before).player,
    teleport: valueOf(teleport),
    after: {
      login_status: afterValue.login_status,
      player: afterValue.player,
      nearby_entities: afterValue.nearby_entities,
      recent_events: afterValue.recent_events,
    },
  }, null, 2));
  if (!applied) {
    throw new Error(
      "Service teleport was queued but not applied; confirm the local character " +
      "has GM level 1 in its current server session.",
    );
  }
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close();
}
