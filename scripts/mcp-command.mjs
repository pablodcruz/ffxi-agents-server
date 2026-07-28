#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const commandIndex = process.argv.indexOf("--command");
const command = commandIndex >= 0 ? process.argv[commandIndex + 1] : undefined;

if (!command) {
  throw new Error("--command is required and must pass the MCP gameplay allowlist.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-command", version: "0.1.0" });

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

  const response = await client.callTool({
    name: "ffxi_gameplay_command",
    arguments: { command },
  });
  if (response.isError) {
    throw new Error("The MCP gameplay command was rejected.");
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const observation = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 30, max_entities: 32, event_limit: 20 },
  });

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    command: valueOf(response).command,
    result: valueOf(response),
    observation: valueOf(observation),
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
    .catch(() => {});
  await client.close();
}
