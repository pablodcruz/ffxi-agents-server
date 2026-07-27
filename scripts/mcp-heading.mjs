#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const headingIndex = process.argv.indexOf("--heading");
const heading = headingIndex >= 0
  ? Number.parseFloat(process.argv[headingIndex + 1])
  : Number.NaN;

if (!Number.isFinite(heading) || heading < -Math.PI || heading > Math.PI) {
  throw new Error("--heading must be a finite number from -pi through pi.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-heading", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
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

    faceHeading = await client.callTool({
      name: "ffxi_face_heading",
      arguments: { heading },
    });
    observation = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 10, max_entities: 8, event_limit: 5 },
    });

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      requested_heading: heading,
      face_heading: valueOf(faceHeading),
      observation: {
        player: valueOf(observation).player,
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

  if (faceHeading?.isError || observation?.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
