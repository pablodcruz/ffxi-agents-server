#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const confirmMode = process.argv.includes("--confirm");
const targetArgumentIndex = process.argv.indexOf("--target");
const targetName = targetArgumentIndex >= 0
  ? process.argv[targetArgumentIndex + 1]
  : undefined;
const serverIdArgumentIndex = process.argv.indexOf("--server-id");
const serverId = serverIdArgumentIndex >= 0
  ? Number(process.argv[serverIdArgumentIndex + 1])
  : undefined;

if (!confirmMode && !targetName && !serverId) {
  throw new Error(
    "Target interaction requires --target or --server-id for one exact nearby entity.",
  );
}
if (serverId !== undefined && (!Number.isInteger(serverId) || serverId <= 0)) {
  throw new Error("--server-id must be one exact positive entity ID.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-interact", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function summarizeObservation(response) {
  const value = valueOf(response);
  return {
    agent_id: value.agent_id,
    login_status: value.login_status,
    player: value.player,
    target: value.target,
    party: value.party,
    control: value.control,
    recent_events: value.recent_events?.slice(-8),
  };
}

function summarizeState(response) {
  const value = valueOf(response);
  return {
    agent_id: value.agent_id,
    menu_open: value.menu_open,
    player: value.player,
    statuses: value.statuses?.filter((status) => status.buff_id > 0),
  };
}

async function waitForExactTarget() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const observation = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 10, max_entities: 12, event_limit: 10 },
    });
    if (observation.isError) throw new Error("FFXI observation failed.");
    const observedTarget = valueOf(observation).target;
    if (
      (serverId && observedTarget?.server_id === serverId)
      || (!serverId && observedTarget?.name === targetName)
    ) {
      return observedTarget;
    }
  }
  return null;
}

try {
  await client.connect(transport);
  const before = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 10, max_entities: 12, event_limit: 10 },
  });
  const beforeState = await client.callTool({
    name: "ffxi_character_state",
    arguments: { include_recasts: false },
  });

  let interaction;
  let after;
  let afterState;
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (!confirmMode) {
      const clearTarget = await client.callTool({
        name: "ffxi_clear_target",
        arguments: {},
      });
      if (clearTarget.isError || !valueOf(clearTarget).cleared) {
        throw new Error("Could not normalize the client target state.");
      }
      const targetSelection = await client.callTool({
        name: "ffxi_target_entity",
        arguments: {
          server_id: serverId,
          name: targetName,
          max_distance: 6,
        },
      });
      if (targetSelection.isError || !(await waitForExactTarget())) {
        throw new Error("The client did not accept the exact interaction target.");
      }
    }
    interaction = await client.callTool({
      name: "ffxi_interact",
      arguments: confirmMode
        ? { mode: "confirm" }
        : {
            mode: "target",
            server_id: serverId,
            name: targetName,
            max_distance: 6,
          },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    after = await client.callTool({
      name: "ffxi_observe",
      arguments: { radius: 10, max_entities: 12, event_limit: 20 },
    });
    afterState = await client.callTool({
      name: "ffxi_character_state",
      arguments: { include_recasts: false },
    });

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      mode: confirmMode ? "confirm" : "target",
      target: targetName,
      before: summarizeObservation(before),
      before_state: summarizeState(beforeState),
      enable: valueOf(enable),
      interaction: valueOf(interaction),
      after: summarizeObservation(after),
      after_state: summarizeState(afterState),
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

  if (
    before.isError ||
    beforeState.isError ||
    interaction?.isError ||
    after?.isError ||
    afterState?.isError
  ) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
