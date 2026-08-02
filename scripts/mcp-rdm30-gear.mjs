#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const steps = [
  ["crown", 15164], ["tunic", 14425], ["mitts", 14857],
  ["slacks", 14326], ["pumps", 15314], ["broadsword", 16545],
];
const itemIds = steps.map(([, itemId]) => itemId);
const alreadyPaid = process.argv.includes("--already-paid");
const correctPaidSeers = process.argv.includes("--correct-paid-seers");
const wrongSteps = [
  ["remove_seers_crown", 15163], ["remove_seers_tunic", 14424],
  ["remove_seers_mitts", 14856], ["remove_seers_slacks", 14325],
  ["remove_seers_pumps", 15313],
];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-rdm30-gear", version: "0.1.0" });
const valueOf = (response) => response.structuredContent || response.content;

async function state() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: { inventory_container: 0, max_items: 80, include_recasts: false },
  });
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

const count = (snapshot, itemId) => snapshot.inventory?.items
  ?.filter((item) => Number(item.item_id) === itemId)
  .reduce((total, item) => total + Number(item.count || 0), 0) || 0;

try {
  await client.connect(transport);
  const before = await state();
  if (before.player?.main_job_id !== 5 || before.player?.main_job_level < 30) {
    throw new Error("The RDM30 checkpoint requires Red Mage level 30 or higher.");
  }
  if (before.menu_open) throw new Error("Close the in-game menu before the checkpoint.");
  if (!correctPaidSeers && (before.inventory?.capacity || 0) - (before.inventory?.count || 0) < itemIds.length) {
    throw new Error("The RDM30 checkpoint requires six free inventory slots.");
  }
  if (itemIds.some((itemId) => count(before, itemId) > 1)) {
    throw new Error("The RDM30 checkpoint found a duplicated checkpoint item.");
  }
  if (correctPaidSeers && wrongSteps.some(([, itemId]) => count(before, itemId) !== 1)) {
    throw new Error("The paid Seer's correction requires all five exact Seer's pieces.");
  }

  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");
  const appliedSteps = [];
  async function applyStep(step) {
    const response = await client.callTool({
      name: "ffxi_private_server_rdm30_gear",
      arguments: { step, confirmation: "APPLY PRIVATE SERVER RDM30 GEAR STEP" },
    });
    if (response.isError) throw new Error(`RDM30 step ${step} was rejected.`);
    appliedSteps.push({ step, result: valueOf(response) });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (correctPaidSeers) {
    await applyStep("adjust");
    let correctionState = before;
    for (const [step, itemId] of wrongSteps) {
      await applyStep(step);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        correctionState = await state();
        if (count(correctionState, itemId) === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (count(correctionState, itemId) !== 0) {
        throw new Error(`RDM30 correction ${step} did not remove item ${itemId}.`);
      }
    }
  } else if (!alreadyPaid) {
    await applyStep("charge");
  }
  let after = before;
  for (const [step, itemId] of steps) {
    if (correctPaidSeers && step === "broadsword" && count(after, itemId) === 1) continue;
    if (count(after, itemId) === 1) continue;
    await applyStep(step);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      after = await state();
      if (count(after, itemId) === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (count(after, itemId) !== 1) {
      throw new Error(`RDM30 step ${step} did not verify item ${itemId}.`);
    }
  }
  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    already_paid: alreadyPaid,
    applied_steps: appliedSteps.map(({ step }) => step),
    corrected_paid_seers: correctPaidSeers,
    sparks_cost_expected: 1077,
    item_ids: itemIds,
    inventory_count_before: before.inventory.count,
    inventory_count_after: after.inventory.count,
    inventory_verified: true,
  }, null, 2));
} finally {
  await client.callTool({ name: "ffxi_emergency_stop", arguments: {} }).catch(() => {});
  await client.close().catch(() => {});
}
