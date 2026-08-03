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

function integerArgument(name, fallback) {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

const action = String(argument("--action", "status")).toLowerCase();
if (!["start", "status", "stop"].includes(action)) {
  throw new Error("--action must be start, status, or stop.");
}

const headingArgument = argument("--heading");
const heading = headingArgument === undefined ? undefined : Number.parseFloat(headingArgument);
if (heading !== undefined && (!Number.isFinite(heading) || heading < -Math.PI || heading > Math.PI)) {
  throw new Error("--heading must be a finite number from -pi through pi.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-fishing-control", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  let response;
  if (action === "start") {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");
    if (heading !== undefined) {
      const face = await client.callTool({
        name: "ffxi_face_heading",
        arguments: { heading },
      });
      if (face.isError) throw new Error("Could not set the fishing heading.");
    }
    response = await client.callTool({
      name: "ffxi_fishing_bot_start",
      arguments: {
        target_skill: integerArgument("--target-skill", 10),
        bait_item_id: integerArgument("--bait-item-id", 17396),
        maximum_seconds: integerArgument("--maximum-seconds", 1800),
        maximum_casts: integerArgument("--maximum-casts", 100),
        minimum_free_inventory_slots: integerArgument("--minimum-free-inventory-slots", 3),
        confirmation: argument("--confirmation", ""),
      },
    });
  } else {
    response = await client.callTool({
      name: action === "stop" ? "ffxi_fishing_bot_stop" : "ffxi_fishing_bot_status",
      arguments: {},
    });
  }
  if (response.isError) {
    const detail = response.content?.map((entry) => entry.text).filter(Boolean).join(" ");
    throw new Error(`Fishing bot ${action} failed${detail ? `: ${detail}` : "."}`);
  }
  console.log(JSON.stringify({ protocol: "mcp-stdio", action, ...valueOf(response) }, null, 2));
} finally {
  await client.close().catch(() => {});
}
