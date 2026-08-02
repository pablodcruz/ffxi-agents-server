#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const spells = Object.freeze([
  Object.freeze({ name: "cure_ii", id: 2, minimumRdmLevel: 14 }),
  Object.freeze({ name: "cure_iii", id: 3, minimumRdmLevel: 26 }),
  Object.freeze({ name: "raise", id: 12, minimumRdmLevel: 38 }),
  Object.freeze({ name: "slow", id: 56, minimumRdmLevel: 13 }),
  Object.freeze({ name: "haste", id: 57, minimumRdmLevel: 48 }),
  Object.freeze({ name: "paralyze", id: 58, minimumRdmLevel: 6 }),
  Object.freeze({ name: "silence", id: 59, minimumRdmLevel: 18 }),
  Object.freeze({ name: "regen", id: 108, minimumRdmLevel: 21 }),
  Object.freeze({ name: "refresh", id: 109, minimumRdmLevel: 41 }),
  Object.freeze({ name: "gravity", id: 216, minimumRdmLevel: 21 }),
  Object.freeze({ name: "sleep", id: 253, minimumRdmLevel: 25 }),
  Object.freeze({ name: "sleep_ii", id: 259, minimumRdmLevel: 46 }),
  Object.freeze({ name: "dispel", id: 260, minimumRdmLevel: 32 }),
]);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-rdm-utility-spells", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

function eventsOf(response) {
  const value = valueOf(response);
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

async function state() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: { inventory_container: 0, max_items: 5, include_recasts: false },
  });
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

async function recentEvents() {
  const response = await client.callTool({
    name: "ffxi_recent_events",
    arguments: { limit: 100 },
  });
  if (response.isError) throw new Error("Could not read recent events.");
  return eventsOf(response);
}

try {
  await client.connect(transport);
  const before = await state();
  const rdmLevel = Number(before.player?.main_job_id) === 5
    ? Number(before.player?.main_job_level) || 0
    : 0;
  if (rdmLevel <= 0) throw new Error("Utility spell grant requires Red Mage as the main job.");

  const eligible = spells.filter((spell) => rdmLevel >= spell.minimumRdmLevel);
  const deferred = spells.filter((spell) => rdmLevel < spell.minimumRdmLevel);
  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const results = [];
  for (const spell of eligible) {
    const baseline = (await recentEvents()).reduce(
      (maximum, event) => Math.max(maximum, Number(event?.id) || 0),
      0,
    );
    const grant = await client.callTool({
      name: "ffxi_private_server_rdm_spell_grant",
      arguments: {
        spell: spell.name,
        confirmation: "GRANT PRIVATE SERVER RDM SPELL",
      },
    });
    if (grant.isError) throw new Error(`Grant request failed for ${spell.name}.`);

    let messages = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      messages = (await recentEvents()).filter((event) => (
        (Number(event?.id) || 0) > baseline
        && String(event?.message || "").includes("[AgentSpell]")
        && String(event?.message || "").includes(`spell=${spell.id}`)
      ));
      if (messages.some((event) => String(event.message).includes("learned=1"))) break;
    }

    const rejected = messages.some((event) => String(event.message).includes("rejected"));
    const accepted = messages.some((event) => (
      String(event.message).includes("granted")
      || String(event.message).includes("already_learned")
    ));
    const learned = messages.some((event) => String(event.message).includes("learned=1"));
    if (messages.length === 0 || rejected || !accepted || !learned) {
      throw new Error(`Exact server-event verification failed for ${spell.name}.`);
    }
    results.push({ ...spell, messages, verified: true });
    // Ashita can leave the chat command parser in /say mode when consecutive
    // leading-! commands are queued too tightly. Let the prior server command
    // and chat-mode transition fully settle before sending the next grant.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    rdm_level: rdmLevel,
    eligible: results,
    deferred,
    verified: results.length === eligible.length,
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close().catch(() => {});
}
