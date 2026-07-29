#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const actionIndex = process.argv.indexOf("--action");
const action = actionIndex >= 0 ? process.argv[actionIndex + 1] : undefined;
const repeatIndex = process.argv.indexOf("--repeat");
const repeat = repeatIndex >= 0 ? Number(process.argv[repeatIndex + 1]) : 1;
const allowedActions = new Set([
  "confirm",
  "cancel",
  "up",
  "down",
  "left",
  "right",
  "open_context_menu",
  "open_equipment",
  "open_items",
  "open_job_abilities",
  "open_magic",
  "open_main_menu",
  "open_weapon_skills",
  "show_interface",
]);

if (!allowedActions.has(action)) {
  throw new Error(
    `Menu input requires --action ${[...allowedActions].join("|")}.`,
  );
}
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
  throw new Error("--repeat must be an integer from 1 through 20.");
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
  const menuInputs = [];
  let after;
  let events;
  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    for (let index = 0; index < repeat; index += 1) {
      menuInputs.push(await client.callTool({
        name: "ffxi_menu_input",
        arguments: { action },
      }));
      if (index + 1 < repeat) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
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
      repeat,
      before: {
        menu_open: valueOf(before).menu_open,
        menu_name: valueOf(before).menu_name,
        interface_visibility: valueOf(before).interface_visibility,
        activity_overlay: valueOf(before).activity_overlay,
        goal_overlay: valueOf(before).goal_overlay,
        selected_item: valueOf(before).selected_item,
        player: valueOf(before).player,
      },
      enable: valueOf(enable),
      menu_inputs: menuInputs.map(valueOf),
      after: {
        menu_open: valueOf(after).menu_open,
        menu_name: valueOf(after).menu_name,
        interface_visibility: valueOf(after).interface_visibility,
        activity_overlay: valueOf(after).activity_overlay,
        goal_overlay: valueOf(after).goal_overlay,
        selected_item: valueOf(after).selected_item,
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

  if (
    before.isError
    || menuInputs.some((input) => input?.isError)
    || after?.isError
    || events?.isError
  ) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
