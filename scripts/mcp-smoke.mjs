#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const runMovementCycle = process.argv.includes("--move-to-target");
const runGameplayCycle = process.argv.includes("--gameplay-cycle") || runMovementCycle;
const runControlCycle = process.argv.includes("--control-cycle") || runGameplayCycle;
const targetArgumentIndex = process.argv.indexOf("--target");
const targetName = targetArgumentIndex >= 0 ? process.argv[targetArgumentIndex + 1] : undefined;
const radiusArgumentIndex = process.argv.indexOf("--radius");
const maxEntitiesArgumentIndex = process.argv.indexOf("--max-entities");
const maxStartDistanceArgumentIndex = process.argv.indexOf("--max-start-distance");
const movementTimeoutArgumentIndex = process.argv.indexOf("--movement-timeout");
const observationRadius = radiusArgumentIndex >= 0
  ? Number(process.argv[radiusArgumentIndex + 1])
  : 10;
const maxEntities = maxEntitiesArgumentIndex >= 0
  ? Number(process.argv[maxEntitiesArgumentIndex + 1])
  : 8;
const maxStartDistance = maxStartDistanceArgumentIndex >= 0
  ? Number(process.argv[maxStartDistanceArgumentIndex + 1])
  : 10;
const movementTimeout = movementTimeoutArgumentIndex >= 0
  ? Number(process.argv[movementTimeoutArgumentIndex + 1])
  : 5;

if (runGameplayCycle && !targetName) {
  throw new Error("The gameplay cycle requires --target with one exact nearby entity name.");
}
if (!Number.isFinite(observationRadius) || observationRadius < 1 || observationRadius > 50) {
  throw new Error("--radius must be a number from 1 through 50.");
}
if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > 64) {
  throw new Error("--max-entities must be an integer from 1 through 64.");
}
if (!Number.isFinite(maxStartDistance) || maxStartDistance < 2 || maxStartDistance > 40) {
  throw new Error("--max-start-distance must be a number from 2 through 40.");
}
if (!Number.isFinite(movementTimeout) || movementTimeout < 1 || movementTimeout > 20) {
  throw new Error("--movement-timeout must be a number from 1 through 20.");
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
      arguments: {
        radius: observationRadius,
        max_entities: maxEntities,
        event_limit: 5,
      },
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
          arguments: { name: targetName, max_distance: maxStartDistance },
        });
        const check = await client.callTool({
          name: "ffxi_gameplay_command",
          arguments: { command: "/check <t>" },
        });
        let movement;
        if (runMovementCycle && !target.isError) {
          movement = await client.callTool({
            name: "ffxi_move_to_entity",
            arguments: {
              server_id: target.structuredContent.server_id,
              max_start_distance: maxStartDistance,
              stop_distance: 3,
              timeout_seconds: movementTimeout,
              stuck_seconds: 2,
            },
          });
        }
        await new Promise((resolve) => setTimeout(
          resolve,
          runMovementCycle ? (movementTimeout * 1000) + 500 : 1500,
        ));
        const postObservation = await client.callTool({
          name: "ffxi_observe",
          arguments: {
            radius: observationRadius,
            max_entities: maxEntities,
            event_limit: 10,
          },
        });
        const stopMovement = await client.callTool({
          name: "ffxi_stop_movement",
          arguments: {},
        });
        controlCycle = {
          ...controlCycle,
          target,
          check,
          ...(movement ? { movement } : {}),
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
