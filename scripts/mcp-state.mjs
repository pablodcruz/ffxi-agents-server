#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inventoryContainer = Number.parseInt(argument("--inventory-container", "0"), 10);
const maxItems = Number.parseInt(argument("--max-items", "40"), 10);
const includeRecasts = process.argv.includes("--include-recasts");

if (!Number.isInteger(inventoryContainer) || inventoryContainer < 0 || inventoryContainer > 16) {
  throw new Error("--inventory-container must be an integer from 0 through 16.");
}
if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 80) {
  throw new Error("--max-items must be an integer from 1 through 80.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-state", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      inventory_container: inventoryContainer,
      max_items: maxItems,
      include_recasts: includeRecasts,
      max_recasts: 32,
    },
  });
  const value = valueOf(response);

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    agent_id: value.agent_id,
    login_status: value.login_status,
    observed_at: value.observed_at,
    player: value.player,
    menu_open: value.menu_open,
    menu_name: value.menu_name,
    interface_visibility: value.interface_visibility,
    activity_overlay: value.activity_overlay,
    selected_item: value.selected_item,
    statuses: value.statuses?.filter(
      (status) =>
        status.buff_id > 0 ||
        (status.status_icon_id > 0 && status.status_icon_id < 255),
    ),
    ...(includeRecasts ? { recasts: value.recasts } : {}),
    inventory: value.inventory,
  }, null, 2));

  if (response.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
