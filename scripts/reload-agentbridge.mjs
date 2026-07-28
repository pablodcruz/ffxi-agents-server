#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const vmName = process.env.FFXI_PARALLELS_VM || "Windows 11";
const projectDir = path.resolve(import.meta.dirname, "..");
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
const foregroundGameCheck = [
  "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition",
  "'[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
  "[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);';",
  "$window = [Win32.NativeMethods]::GetForegroundWindow();",
  "[uint32]$foregroundProcessId = 0;",
  "[void][Win32.NativeMethods]::GetWindowThreadProcessId($window, [ref]$foregroundProcessId);",
  "$foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue;",
  "if ($null -eq $foregroundProcess -or $foregroundProcess.ProcessName -notin @('pol', 'xiloader')) { Write-Output ('foreground=' + $(if ($null -eq $foregroundProcess) { 'unknown' } else { $foregroundProcess.ProcessName })); exit 42 }",
].join(" ");

function requireLiveBridge() {
  const child = spawnSync(
    path.join(projectDir, "scripts", "run-node.sh"),
    [path.join(projectDir, "src", "doctor.mjs"), "--bridge-only"],
    {
      cwd: projectDir,
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  if (child.error || child.status !== 0) {
    throw new Error(
      "Refusing to type the addon reload command because a logged-in AgentBridge client is not healthy.",
    );
  }
}

function requireForegroundGame() {
  const child = spawnSync(
    "prlctl",
    [
      "exec",
      vmName,
      "powershell.exe",
      "-NoProfile",
      "-Command",
      foregroundGameCheck,
    ],
    {
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  if (child.error || child.status !== 0) {
    const observed = child.stdout?.trim();
    throw new Error(
      `Refusing to type the addon reload command because neither pol.exe nor the live xiloader.exe client is the foreground Windows process${observed ? ` (${observed})` : ""}.`,
    );
  }
}

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
requireLiveBridge();
requireForegroundGame();
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
