#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const objectiveIndex = process.argv.indexOf("--objective-id");
const objectiveId = objectiveIndex >= 0
  ? Number.parseInt(process.argv[objectiveIndex + 1], 10)
  : Number.NaN;

if (!Number.isInteger(objectiveId) || objectiveId < 1 || objectiveId > 4095) {
  throw new Error("--objective-id must be an integer from 1 through 4095.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-start-roe-objective",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  try {
    const start = await client.callTool({
      name: "ffxi_start_roe_objective",
      arguments: {
        objective_id: objectiveId,
        confirmation: "START PRIVATE SERVER ROE OBJECTIVE",
      },
    });
    if (start.isError) {
      throw new Error(
        `Could not start RoE objective ${objectiveId}: ${JSON.stringify(valueOf(start))}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const events = await client.callTool({
      name: "ffxi_recent_events",
      arguments: { limit: 20 },
    });
    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      objective: valueOf(start),
      recent_events: valueOf(events),
    }, null, 2));
  } finally {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
  }
} finally {
  await client.close();
}
