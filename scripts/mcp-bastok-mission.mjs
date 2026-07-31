#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const action = String(argument("--action", "status")).toLowerCase();
const missionId = Number.parseInt(argument("--mission-id", "0"), 10);
const itemId = Number.parseInt(argument("--item-id", "0"), 10);
const quantity = Number.parseInt(argument("--quantity", "0"), 10);
if (!["status", "begin", "donate"].includes(action)) {
  throw new Error("--action must be status, begin, or donate.");
}
if (action === "status" && missionId !== 0) {
  throw new Error("Status requires --mission-id 0 or no mission ID.");
}
if (action === "begin" && ![10, 11, 12].includes(missionId)) {
  throw new Error("Begin requires --mission-id 10, 11, or 12.");
}
if (
  action === "donate" &&
  (!(itemId >= 4096 && itemId <= 4103) || quantity < 1 || quantity > 99)
) {
  throw new Error("Donate requires --item-id 4096-4103 and --quantity 1-99.");
}
const commandValue = action === "donate" ? itemId : missionId;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-bastok-mission",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

function eventListOf(response) {
  const value = valueOf(response);
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

try {
  await client.connect(transport);
  const before = await client.callTool({
    name: "ffxi_character_state",
    arguments: { inventory_container: 0, max_items: 1, include_recasts: false },
  });
  if (before.isError) throw new Error("Could not read character state.");
  const eventsBefore = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 100 },
  });
  if (eventsBefore.isError) throw new Error("Could not establish event baseline.");
  const baselineEventId = eventListOf(eventsBefore).reduce(
    (maximum, entry) => Math.max(maximum, Number(entry?.id) || 0),
    0,
  );

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const command = await client.callTool({
    name: "ffxi_private_server_bastok_mission",
    arguments: {
      action,
      mission_id: commandValue,
      quantity,
      confirmation: "ADVANCE PRIVATE SERVER BASTOK MISSION",
    },
  });
  if (command.isError) {
    const detail = command.content?.map((entry) => entry.text).filter(Boolean).join(" ");
    throw new Error(`Bastok mission command was rejected${detail ? `: ${detail}` : "."}`);
  }

  let missionMessages = [];
  for (let attempt = 0; attempt < 24 && missionMessages.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const events = await client.callTool({
      name: "ffxi_recent_events",
      arguments: { limit: 100 },
    });
    if (events.isError) throw new Error("Could not verify Bastok mission response.");
    missionMessages = eventListOf(events).filter((entry) => (
      (Number(entry?.id) || 0) > baselineEventId &&
      String(entry?.message || "").includes("[AgentMission]")
    ));
  }
  const rejected = missionMessages.some((entry) =>
    String(entry.message).includes("[AgentMission] rejected"));
  const began = missionMessages.some((entry) =>
    String(entry.message).includes(`[AgentMission] began mission=${missionId}`));
  const donated = missionMessages.some((entry) =>
    String(entry.message).includes(`[AgentMission] donated item=${itemId} quantity=${quantity}`));
  if (rejected || (action === "begin" && !began) || (action === "donate" && !donated)) {
    throw new Error(
      `Server did not begin mission ${missionId}; inspect mission_messages in the report.`,
    );
  }
  if (action === "status" && missionMessages.length === 0) {
    throw new Error("Server returned no [AgentMission] status response.");
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    action,
    mission_id: missionId,
    item_id: itemId,
    quantity,
    before: valueOf(before).player,
    command: valueOf(command),
    mission_messages: missionMessages,
    verified: action === "status" ? missionMessages.length > 0 : (began || donated),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close();
}
