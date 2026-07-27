#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const valueIndex = process.argv.indexOf("--enabled");
const rawValue = valueIndex >= 0 ? process.argv[valueIndex + 1] : undefined;

if (!["true", "false"].includes(rawValue)) {
  throw new Error("Activity feed requires --enabled true|false.");
}
const enabled = rawValue === "true";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-activity-feed", version: "0.1.0" });
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

  const feed = await client.callTool({
    name: "ffxi_set_activity_feed",
    arguments: { enabled },
  });
  if (feed.isError) throw new Error("Could not change the local activity feed.");

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
    activity_feed: valueOf(feed),
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
