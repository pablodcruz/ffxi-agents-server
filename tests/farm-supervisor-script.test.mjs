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
