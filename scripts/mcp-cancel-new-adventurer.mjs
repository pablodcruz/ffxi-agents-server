#!/usr/bin/env node

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-cancel-new-adventurer",
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
  if (enable.isError) throw new Error("Could not enable private-server control.");

  const result = await client.callTool({
    name: "ffxi_cancel_new_adventurer_status",
    arguments: {
      confirmation: "CANCEL PRIVATE SERVER NEW ADVENTURER STATUS",
    },
  });
  if (result.isError) {
    throw new Error("New Adventurer cancellation was rejected.");
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const events = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 12 },
  });
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    result: valueOf(result),
    recent_events: valueOf(events).data || valueOf(events),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close();
}
