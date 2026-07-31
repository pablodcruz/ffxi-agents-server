#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const maxStepsIndex = process.argv.indexOf("--max-steps");
const maxSteps = maxStepsIndex >= 0
  ? Number.parseInt(process.argv[maxStepsIndex + 1], 10)
  : 6;

if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) {
  throw new Error("--max-steps must be an integer from 1 through 12.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-dialogue", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function meaningfulEvents(events, afterId) {
  return events.filter((event) =>
    event.id > afterId &&
    event.mode !== -1 &&
    !event.message.includes("You cannot use that command at this time."),
  );
}

try {
  await client.connect(transport);
  const initialState = await client.callTool({
    name: "ffxi_character_state",
    arguments: { include_recasts: false },
  });
  if (initialState.isError || !valueOf(initialState).menu_open) {
    throw new Error("Dialogue advance requires an open in-game menu or dialogue.");
  }
  const initialMenuName = String(valueOf(initialState).menu_name || "");

  const initialEvents = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 20 },
  });
  let lastEventId = Math.max(
    0,
    ...(valueOf(initialEvents).data || valueOf(initialEvents)).map((event) => event.id),
  );
  const steps = [];
  let reason = "max_steps";

  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) {
      throw new Error("Could not arm private-server control.");
    }

    for (let step = 1; step <= maxSteps; step += 1) {
      const confirm = await client.callTool({
        name: "ffxi_menu_input",
        arguments: { action: "confirm" },
      });
      if (confirm.isError) {
        steps.push({ step, error: valueOf(confirm) });
        reason = "confirm_error";
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const [state, recent] = await Promise.all([
        client.callTool({
          name: "ffxi_character_state",
          arguments: { include_recasts: false },
        }),
        client.callTool({
          name: "ffxi_recent_events",
          arguments: { limit: 20 },
        }),
      ]);
      const events = valueOf(recent).data || valueOf(recent);
      const newEvents = meaningfulEvents(events, lastEventId);
      lastEventId = Math.max(lastEventId, ...events.map((event) => event.id));
      const stateValue = valueOf(state);
      const menuOpen = stateValue.menu_open;
      const menuName = String(stateValue.menu_name || "");
      const cinematicMenu = /^menu\s+rem/i.test(menuName);
      const cinematicTransition = menuName === "" && (
        /^menu\s+rem/i.test(initialMenuName)
        || steps.some(
          (entry) => /^menu\s+rem/i.test(String(entry.menu_name || "")),
        )
      );
      steps.push({
        step,
        menu_open: menuOpen,
        menu_name: menuName,
        events: newEvents.map(({ id, mode, message }) => ({ id, mode, message })),
      });

      if (!menuOpen) {
        reason = "dialogue_closed";
        break;
      }
      if (newEvents.length === 0 && !cinematicMenu && !cinematicTransition) {
        reason = "selection_menu_or_no_progress";
        break;
      }
    }
  } finally {
    await client.callTool({
      name: "ffxi_emergency_stop",
      arguments: {},
    });
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    max_steps: maxSteps,
    reason,
    steps,
  }, null, 2));
} finally {
  await client.close();
}
