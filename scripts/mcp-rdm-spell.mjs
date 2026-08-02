#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const spell = String(argument("--spell")).toLowerCase();
const spells = Object.freeze({
  dia_ii: Object.freeze({ spell_id: 24, gil_cost: 11648 }),
  enthunder: Object.freeze({ spell_id: 104, gil_cost: 1575 }),
});
const config = spells[spell];
if (!config) throw new Error("--spell must be dia_ii or enthunder.");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-rdm-spell", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function eventsOf(response) {
  const value = valueOf(response);
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

function gil(snapshot) {
  return Number(snapshot.inventory?.items
    ?.find((item) => Number(item.item_id) === 65535)?.count || 0);
}

async function state() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: { inventory_container: 0, max_items: 80, include_recasts: false },
  });
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

try {
  await client.connect(transport);
  const before = await state();
  const eventsBefore = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 100 },
  });
  if (eventsBefore.isError) throw new Error("Could not establish event baseline.");
  const baselineEventId = eventsOf(eventsBefore).reduce(
    (maximum, event) => Math.max(maximum, Number(event?.id) || 0),
    0,
  );
  const beforeGil = gil(before);
  if (beforeGil < config.gil_cost) {
    throw new Error(`Insufficient gil: have ${beforeGil}, need ${config.gil_cost}.`);
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const purchase = await client.callTool({
    name: "ffxi_private_server_rdm_spell",
    arguments: {
      spell,
      confirmation: "BUY PRIVATE SERVER RDM SPELL",
    },
  });
  if (purchase.isError) throw new Error("The RDM spell purchase was rejected by AgentBridge.");

  let messages = [];
  let after = before;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const events = await client.callTool({
      name: "ffxi_recent_events",
      arguments: { limit: 100 },
    });
    if (events.isError) throw new Error("Could not verify RDM spell response.");
    messages = eventsOf(events).filter((event) => (
      (Number(event?.id) || 0) > baselineEventId
      && String(event?.message || "").includes("[AgentSpell]")
    ));
    if (messages.some((event) => String(event.message).includes("[AgentSpell] status"))) {
      after = await state();
      break;
    }
  }

  const rejected = messages.some((event) => String(event.message).includes("[AgentSpell] rejected"));
  const purchased = messages.some((event) => String(event.message).includes(
    `[AgentSpell] purchased spell=${config.spell_id} gil=${config.gil_cost}`,
  ));
  const learned = messages.some((event) => String(event.message).includes(
    `[AgentSpell] status spell=${config.spell_id} learned=1`,
  ));
  const afterGil = gil(after);
  if (
    messages.length === 0
    || rejected
    || !purchased
    || !learned
    || afterGil !== beforeGil - config.gil_cost
  ) {
    throw new Error("RDM spell purchase failed exact server-event and gil verification.");
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    spell,
    spell_id: config.spell_id,
    gil_cost: config.gil_cost,
    gil_before: beforeGil,
    gil_after: afterGil,
    messages,
    verified: true,
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close().catch(() => {});
}
