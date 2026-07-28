#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const shami = Object.freeze({
  name: "Shami",
  serverId: 17784905,
  zoneId: 246,
});
const beastmensSealId = 1126;
const maximumIndex = process.argv.indexOf("--maximum");
const maximum = maximumIndex >= 0
  ? Number.parseInt(process.argv[maximumIndex + 1], 10)
  : 99;

if (!Number.isInteger(maximum) || maximum < 1 || maximum > 99) {
  throw new Error("--maximum must be an integer from 1 through 99.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-store-seals",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) {
    const detail = response.content?.map((entry) => entry.text).join(" ") || "";
    throw new Error(`${name} failed${detail ? `: ${detail}` : "."}`);
  }
  return valueOf(response);
}

async function state() {
  return call("ffxi_character_state", {
    inventory_container: 0,
    max_items: 80,
    include_recasts: false,
  });
}

function sealCount(current) {
  return current.inventory?.items
    ?.filter((item) => Number(item.item_id) === beastmensSealId)
    .reduce((total, item) => total + Number(item.count), 0) || 0;
}

async function closeStorageDialogue() {
  const messages = [];
  for (let step = 0; step < 4; step += 1) {
    const current = await state();
    if (!current.menu_open) return messages;
    if (String(current.menu_name || "").trim() !== "menu    rem4li2") {
      throw new Error(
        `Refusing to advance unexpected menu ${String(current.menu_name || "").trim() || "unknown"}.`,
      );
    }
    await call("ffxi_menu_input", { action: "confirm" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const events = await call("ffxi_recent_events", { limit: 24 });
    for (const event of events.data || events) {
      if (/balance of \d+ .*beastmen's seal/i.test(event.message)) {
        messages.push(event.message);
      }
    }
  }
  if ((await state()).menu_open) {
    throw new Error("Shami storage dialogue did not close within four confirms.");
  }
  return messages;
}

await client.connect(transport);
let stored = 0;
let observedBalanceMessage = null;
try {
  const initial = await state();
  if (initial.menu_open) {
    throw new Error("Close all in-game menus before storing seals.");
  }
  const initialCount = sealCount(initial);
  if (initialCount < 1) {
    throw new Error("Inventory does not contain Beastmen's Seal item 1126.");
  }

  const initialObservation = await call("ffxi_observe", {
    radius: 6,
    max_entities: 24,
    event_limit: 12,
  });
  if (Number(initialObservation.party?.[0]?.zone_id) !== shami.zoneId) {
    throw new Error("Seal storage is allowed only beside Shami in Port Jeuno.");
  }
  const exactShami = initialObservation.nearby_entities?.find((entity) => (
    Number(entity.server_id) === shami.serverId
    && entity.name === shami.name
    && Number(entity.distance) <= 6
  ));
  if (!exactShami) {
    throw new Error("Exact Shami NPC is not active within six yalms.");
  }

  await call("ffxi_enable_control", {
    confirmation: "ENABLE PRIVATE SERVER CONTROL",
  });
  const requested = Math.min(initialCount, maximum);
  for (let index = 0; index < requested; index += 1) {
    const before = await state();
    const beforeCount = sealCount(before);
    if (before.menu_open || beforeCount < 1) break;

    await call("ffxi_clear_target", {});
    await call("ffxi_target_entity", {
      server_id: shami.serverId,
      name: shami.name,
      max_distance: 6,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const verified = await call("ffxi_observe", {
      radius: 6,
      max_entities: 12,
      event_limit: 8,
    });
    if (Number(verified.target?.server_id) !== shami.serverId) {
      throw new Error("Exact Shami target verification failed.");
    }

    await call("ffxi_gameplay_command", {
      command: "/item \"Beastmen's Seal\" <t>",
    });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const after = await state();
    if (sealCount(after) !== beforeCount - 1) {
      throw new Error("Shami did not consume exactly one Beastmen's Seal.");
    }
    if (
      !after.menu_open
      || String(after.menu_name || "").trim() !== "menu    rem4li2"
    ) {
      throw new Error("Shami did not open the expected storage confirmation.");
    }
    stored += 1;
    const balanceMessages = await closeStorageDialogue();
    observedBalanceMessage = balanceMessages.at(-1) || observedBalanceMessage;
  }

  const final = await state();
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    target: shami,
    item_id: beastmensSealId,
    initial_count: initialCount,
    stored_count: stored,
    remaining_count: sealCount(final),
    inventory_count: final.inventory?.count,
    observed_balance_message: observedBalanceMessage,
  }, null, 2));
} finally {
  await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: {},
  }).catch(() => {});
  await client.close();
}
