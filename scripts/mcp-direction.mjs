#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const actionIndex = process.argv.indexOf("--action");
const durationIndex = process.argv.indexOf("--duration-ms");
const headingIndex = process.argv.indexOf("--heading");
const action = actionIndex >= 0 ? process.argv[actionIndex + 1] : undefined;
const durationMs = durationIndex >= 0
  ? Number.parseInt(process.argv[durationIndex + 1], 10)
  : 250;
const heading = headingIndex >= 0
  ? Number.parseFloat(process.argv[headingIndex + 1])
  : undefined;
const allowedActions = new Set([
  "forward",
  "backward",
  "turn_left",
  "turn_right",
  "camera_left",
  "camera_right",
]);

if (!allowedActions.has(action)) {
  throw new Error(
    "Directional input requires --action forward|backward|turn_left|turn_right|camera_left|camera_right.",
  );
}
if (!Number.isInteger(durationMs) || durationMs < 50 || durationMs > 1000) {
  throw new Error("--duration-ms must be an integer from 50 through 1000.");
}
if (
  heading !== undefined
  && (!Number.isFinite(heading) || heading < -Math.PI || heading > Math.PI)
) {
  throw new Error("--heading must be a finite number from -pi through pi.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-direction", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  let direction;
  let faceHeading;
  let observation;
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) {
      throw new Error("Could not arm private-server control.");
    }

    if (heading !== undefined) {
      faceHeading = await client.callTool({
        name: "ffxi_face_heading",
        arguments: { heading },
      });
      if (faceHeading.isError) {
        throw new Error("Could not set the requested heading.");
      }
    }

    direction = await client.callTool({
      name: "ffxi_directional_input",
      arguments: { action, duration_ms: durationMs },
    });
    observation = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 10, max_entities: 8, event_limit: 5 },
    });

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      action,
      duration_ms: durationMs,
      requested_heading: heading,
      face_heading: faceHeading ? valueOf(faceHeading) : null,
      directional_input: valueOf(direction),
      observation: {
        player: valueOf(observation).player,
        target: valueOf(observation).target,
        nearby_entities: valueOf(observation).nearby_entities,
      },
    }, null, 2));
  } finally {
    const emergencyStop = await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
    if (emergencyStop.isError) {
      console.error("Emergency stop failed.");
      process.exitCode = 1;
    }
  }

  if (direction?.isError || observation?.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
