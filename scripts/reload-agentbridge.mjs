#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const vmName = process.env.FFXI_PARALLELS_VM || "Windows 11";
const keyCodes = Object.freeze({
  "/": 61,
  " ": 65,
  a: 38,
  b: 56,
  d: 40,
  e: 26,
  g: 42,
  i: 31,
  l: 46,
  n: 57,
  o: 32,
  r: 27,
  t: 28,
});
const command = "/addon reload agentbridge";

function sendKey(keyCode, delay = 35) {
  const child = spawnSync(
    "prlctl",
    [
      "send-key-event",
      vmName,
      "--key",
      String(keyCode),
      "--delay",
      String(delay),
    ],
    {
      timeout: 3000,
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    },
  );
  if (child.error || child.status !== 0) {
    const detail = child.error?.message || child.stderr?.trim() || `exit ${child.status}`;
    throw new Error(`Could not send Parallels key event ${keyCode}: ${detail}`);
  }
}

// Escape any partially entered chat text, then type one fixed, non-chat command.
sendKey(9, 80);
for (const character of command) {
  sendKey(keyCodes[character]);
}
sendKey(36, 80);

console.log(JSON.stringify({
  status: "submitted",
  vm: vmName,
  command: "/addon reload agentbridge",
  bounded_key_events: command.length + 2,
}));
