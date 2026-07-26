#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const runGameplayCycle = process.argv.includes("--gameplay-cycle");
const runControlCycle = process.argv.includes("--control-cycle") || runGameplayCycle;
const targetArgumentIndex = process.argv.indexOf("--target");
const targetName = targetArgumentIndex >= 0 ? process.argv[targetArgumentIndex + 1] : undefined;

if (runGameplayCycle && !targetName) {
  throw new Error("The gameplay cycle requires --target with one exact nearby entity name.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const [profiles, control, observation, server] = await Promise.all([
    client.callTool({ name: "ffxi_agent_profiles", arguments: {} }),
    client.callTool({ name: "ffxi_control_status", arguments: {} }),
    client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 10, max_entities: 8, event_limit: 5 },
    }),
    client.callTool({ name: "ffxi_server_status", arguments: {} }),
  ]);

  const calls = { profiles, control, observation, server };
  let controlCycle;
  if (runControlCycle) {
    try {
      const enable = await client.callTool({
        name: "ffxi_enable_control",
        arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
      });
      const enabledStatus = await client.callTool({
        name: "ffxi_control_status",
        arguments: {},
      });
      controlCycle = { enable, enabledStatus };
      if (runGameplayCycle) {
        const target = await client.callTool({
          name: "ffxi_target_entity",
          arguments: { name: targetName, max_distance: 10 },
        });
        const check = await client.callTool({
          name: "ffxi_gameplay_command",
          arguments: { command: "/check <t>" },
        });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const postObservation = await client.callTool({
          name: "ffxi_observe",
          arguments: { radius: 10, max_entities: 8, event_limit: 10 },
        });
        const stopMovement = await client.callTool({
          name: "ffxi_stop_movement",
          arguments: {},
        });
        controlCycle = {
          ...controlCycle,
          target,
          check,
          postObservation,
          stopMovement,
        };
      }
    } finally {
      const emergencyStop = await client.callTool({
        name: "ffxi_emergency_stop",
        arguments: {},
      });
      controlCycle = { ...controlCycle, emergencyStop };
    }
  }
  const failed = Object.entries(calls)
    .filter(([, response]) => response.isError)
    .map(([name]) => name);
  if (controlCycle) {
    failed.push(
      ...Object.entries(controlCycle)
        .filter(([, response]) => response.isError)
        .map(([name]) => `control_cycle.${name}`),
    );
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    tool_count: tools.tools.length,
    tools: tools.tools.map((tool) => tool.name).sort(),
    calls: Object.fromEntries(
      Object.entries(calls).map(([name, response]) => [
        name,
        response.structuredContent || response.content,
      ]),
    ),
    control_cycle: controlCycle
      ? Object.fromEntries(
        Object.entries(controlCycle).map(([name, response]) => [
          name,
          response.structuredContent || response.content,
        ]),
      )
      : null,
  }, null, 2));

  if (failed.length > 0) {
    console.error(`MCP smoke calls failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
