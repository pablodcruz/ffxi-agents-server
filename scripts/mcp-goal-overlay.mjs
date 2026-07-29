#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const rawEnabled = option("--enabled");
if (!["true", "false"].includes(rawEnabled)) {
  throw new Error("Goal overlay requires --enabled true|false.");
}

function parseGil(name) {
  const raw = option(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < (name === "--target-gil" ? 1 : 0)) {
    throw new Error(`${name} requires a non-negative integer${name === "--target-gil" ? " greater than zero" : ""}.`);
  }
  return value;
}

const enabled = rawEnabled === "true";
const currentGil = parseGil("--current-gil");
const targetGil = parseGil("--target-gil");
const title = option("--title");
const progressLabel = option("--progress");
if ((title === undefined) !== (progressLabel === undefined)) {
  throw new Error("--title and --progress must be provided together.");
}
if (title?.includes("\n") || title?.includes("\r") || title?.length > 96) {
  throw new Error("--title must be a single-line string up to 96 characters.");
}
if (
  progressLabel?.includes("\n")
  || progressLabel?.includes("\r")
  || progressLabel?.length > 128
) {
  throw new Error("--progress must be a single-line string up to 128 characters.");
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-goal-overlay", version: "0.1.0" });
let connected = false;

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  connected = true;
  const arm = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (arm.isError) throw new Error("Could not arm private-server control.");

  const goal = await client.callTool({
    name: "ffxi_set_goal_overlay",
    arguments: {
      enabled,
      current_gil: currentGil,
      target_gil: targetGil,
      ...(title === undefined
        ? {}
        : { title, progress_label: progressLabel }),
    },
  });
  if (goal.isError) throw new Error("Could not change the local goal overlay.");

  const emergencyStop = await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: {},
  });
  const finalControl = await client.callTool({
    name: "ffxi_control_status",
    arguments: {},
  });
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    goal_overlay: valueOf(goal),
    emergency_stop: valueOf(emergencyStop),
    final_control: valueOf(finalControl),
  }, null, 2));
} finally {
  if (connected) {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
    await client.close().catch(() => {});
  }
}
