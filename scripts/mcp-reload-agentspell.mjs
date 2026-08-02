#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
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
const client = new Client({ name: "ffxi-agent-lab-reload-agentspell", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function eventsOf(response) {
  const value = valueOf(response);
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

try {
  await client.connect(transport);
  const eventsBefore = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 100 },
  });
  if (eventsBefore.isError) throw new Error("Could not establish event baseline.");
  const baseline = eventsOf(eventsBefore).reduce(
    (maximum, event) => Math.max(maximum, Number(event?.id) || 0),
    0,
  );
  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");
  const reload = await client.callTool({
    name: "ffxi_private_server_reload_agentspell",
    arguments: { confirmation: "RELOAD PRIVATE SERVER AGENTSPELL" },
  });
  if (reload.isError) throw new Error("AgentSpell reload request was rejected.");

  let messages = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const events = await client.callTool({
      name: "ffxi_recent_events",
      arguments: { limit: 100 },
    });
    if (events.isError) throw new Error("Could not verify AgentSpell reload.");
    messages = eventsOf(events).filter((event) => (
      (Number(event?.id) || 0) > baseline
      && String(event?.message || "").includes("[AgentReload]")
    ));
    if (messages.length > 0) break;
  }
  const succeeded = messages.some((event) => String(event.message).includes("reloaded module=agentspell"));
  const failed = messages.some((event) => String(event.message).includes("failed"));
  if (!succeeded || failed) throw new Error("AgentSpell reload failed exact event verification.");

  console.log(JSON.stringify({ protocol: "mcp-stdio", messages, verified: true }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close().catch(() => {});
}
