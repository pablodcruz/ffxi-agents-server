#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const actionIndex = process.argv.indexOf("--action");
const action = actionIndex >= 0 ? process.argv[actionIndex + 1] : undefined;
const allowedActions = new Set(["confirm", "cancel", "up", "down"]);

if (!allowedActions.has(action)) {
  throw new Error("Menu input requires --action confirm|cancel|up|down.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-menu", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const before = await client.callTool({
    name: "ffxi_character_state",
    arguments: { include_recasts: false },
  });
  let menuInput;
  let after;
  let events;
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    menuInput = await client.callTool({
      name: "ffxi_menu_input",
      arguments: { action },
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    [after, events] = await Promise.all([
      client.callTool({
        name: "ffxi_character_state",
        arguments: { include_recasts: false },
      }),
      client.callTool({
        name: "ffxi_recent_events",
        arguments: { limit: 10 },
      }),
    ]);

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      action,
      before: {
        menu_open: valueOf(before).menu_open,
        player: valueOf(before).player,
      },
      enable: valueOf(enable),
      menu_input: valueOf(menuInput),
      after: {
        menu_open: valueOf(after).menu_open,
        player: valueOf(after).player,
      },
      recent_events: valueOf(events).data || valueOf(events),
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

  if (before.isError || menuInput?.isError || after?.isError || events?.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
