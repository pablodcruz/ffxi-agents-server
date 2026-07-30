#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const jobs = new Map([
  ["war", 1], ["mnk", 2], ["whm", 3], ["blm", 4], ["rdm", 5], ["thf", 6],
  ["pld", 7], ["drk", 8], ["bst", 9], ["brd", 10], ["rng", 11], ["sam", 12],
  ["nin", 13], ["drg", 14], ["smn", 15], ["blu", 16], ["cor", 17], ["pup", 18],
  ["dnc", 19], ["sch", 20], ["geo", 21], ["run", 22],
]);
const slot = argument("--slot")?.toLowerCase();
const job = argument("--job")?.toLowerCase();
const jobId = jobs.get(job);
if (!["main", "sub"].includes(slot)) {
  throw new Error("Job change requires --slot main|sub.");
}
if (!jobId) {
  throw new Error(`Job change requires --job ${[...jobs.keys()].join("|")}.`);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-job-change", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const enable = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  if (enable.isError) throw new Error("Could not arm private-server control.");

  const before = await client.callTool({
    name: "ffxi_character_state",
    arguments: {},
  });
  if (before.isError) throw new Error("Could not read character state before job change.");

  const change = await client.callTool({
    name: "ffxi_change_job",
    arguments: {
      slot,
      job_id: jobId,
      confirmation: "CHANGE PRIVATE SERVER JOB",
    },
  });
  if (change.isError) {
    const detail = change.content?.map((entry) => entry.text).filter(Boolean).join(" ");
    throw new Error(`Job change was rejected${detail ? `: ${detail}` : "."}`);
  }

  let after;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await client.callTool({
      name: "ffxi_character_state",
      arguments: {},
    });
    if (response.isError) continue;
    after = valueOf(response);
    const actual = slot === "main"
      ? Number(after?.player?.main_job_id)
      : Number(after?.player?.sub_job_id);
    if (actual === jobId) break;
  }
  const actual = slot === "main"
    ? Number(after?.player?.main_job_id)
    : Number(after?.player?.sub_job_id);
  if (actual !== jobId) {
    throw new Error(`Job change packet was sent, but ${slot} job did not become ${job.toUpperCase()}.`);
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    slot,
    job: job.toUpperCase(),
    job_id: jobId,
    before: valueOf(before)?.player,
    change: valueOf(change),
    after: after?.player,
  }, null, 2));
} finally {
  await client.close();
}
