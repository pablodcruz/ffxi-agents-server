#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { selectSafeTarget } from "../src/safe-target-selector.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function argumentsFor(name) {
  return process.argv
    .flatMap((entry, index) => (
      entry === name && process.argv[index + 1]
        ? [process.argv[index + 1]]
        : []
    ));
}

const allowedNames = argumentsFor("--target");
const timeoutSeconds = Number(argument("--timeout", "55"));
const pollSeconds = Number(argument("--poll-seconds", "5"));
const maximumDistance = Number(argument("--maximum-distance", "20"));
const maximumElevationDifference = Number(
  argument("--maximum-elevation-difference", "4"),
);

if (allowedNames.length === 0 || allowedNames.some((name) => name.length > 64)) {
  throw new Error("Provide one or more exact --target names of at most 64 characters.");
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 55) {
  throw new Error("--timeout must be from 1 through 55 seconds.");
}
if (!Number.isFinite(pollSeconds) || pollSeconds < 1 || pollSeconds > 10) {
  throw new Error("--poll-seconds must be from 1 through 10.");
}
if (!Number.isFinite(maximumDistance) || maximumDistance < 3 || maximumDistance > 50) {
  throw new Error("--maximum-distance must be from 3 through 50.");
}
if (
  !Number.isFinite(maximumElevationDifference)
  || maximumElevationDifference < 1
  || maximumElevationDifference > 20
) {
  throw new Error("--maximum-elevation-difference must be from 1 through 20.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "ffxi-agent-lab-wait-target", version: "0.1.0" });

function valueOf(response) {
  return response.structuredContent || response.content;
}

try {
  await client.connect(transport);
  const deadline = Date.now() + (timeoutSeconds * 1000);
  let polls = 0;
  let candidate = null;
  let lastObservation;

  while (Date.now() <= deadline) {
    const response = await client.callTool({
      name: "ffxi_observe",
      arguments: {
        radius: maximumDistance,
        max_entities: 64,
        event_limit: 3,
      },
    });
    if (response.isError) throw new Error("FFXI observation failed.");
    lastObservation = valueOf(response);
    polls += 1;
    candidate = selectSafeTarget({
      player: lastObservation.player,
      entities: lastObservation.nearby_entities,
      allowedNames,
      maximumDistance,
      maximumElevationDifference,
    });
    if (candidate) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(pollSeconds * 1000, remaining),
    ));
  }

  console.log(JSON.stringify({
    protocol: "mcp-stdio",
    mode: "read-only-target-watch",
    allowed_names: allowedNames,
    polls,
    found: Boolean(candidate),
    candidate,
    player: lastObservation?.player,
    control: lastObservation?.control,
  }, null, 2));
} finally {
  await client.close();
}
