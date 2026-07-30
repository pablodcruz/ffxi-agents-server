import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectDir = path.resolve(import.meta.dirname, "..");

test("farm supervisor contains no calls to the retired immediate-stop helper", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /\bstopRequested\s*\(/);
  assert.match(source, /\blatchCooperativeStopRequest\s*\(/);
});

test("NM route delays Trust casts and exposes its NM kill counter", async () => {
  const source = await fs.readFile(
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "utf8",
  );
  assert.match(source, /postZoneTrustDelayMilliseconds = 12_000/);
  assert.match(source, /interTrustSummonDelayMilliseconds = 2_000/);
  assert.match(source, /NMS KILLED \$\{counters\.notorious_monsters_killed\}/);
});
