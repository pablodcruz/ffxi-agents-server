#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

const vmName = process.env.FFXI_PARALLELS_VM || "Windows 11";
const projectDir = path.resolve(import.meta.dirname, "..");
const keyCodes = Object.freeze({
  "/": 53,
  " ": 57,
  a: 30,
  b: 48,
  d: 32,
  e: 18,
  g: 34,
  i: 23,
  l: 38,
  n: 49,
  o: 24,
  r: 19,
  t: 20,
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
  "if ($null -ne $foregroundProcess -and $foregroundProcess.ProcessName -in @('pol', 'xiloader')) { exit 0 }",
  "$windowlessLoaders = @(Get-Process -Name xiloader -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq 1 });",
  "if ($null -ne $foregroundProcess -and $foregroundProcess.ProcessName -eq 'Idle' -and $windowlessLoaders.Count -eq 1) { Write-Output 'foreground=Idle windowless=xiloader'; exit 0 }",
  "Write-Output ('foreground=' + $(if ($null -eq $foregroundProcess) { 'unknown' } else { $foregroundProcess.ProcessName }) + ' windowless_loaders=' + $windowlessLoaders.Count);",
  "exit 42",
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
      `Refusing to type the addon reload command because neither a foreground game process nor exactly one interactive windowless xiloader.exe was verified${observed ? ` (${observed})` : ""}.`,
    );
  }
}

function sendScanCode(scanCode, delay = 35) {
  const child = spawnSync(
    "prlctl",
    [
      "send-key-event",
      vmName,
      "--scancode",
      String(scanCode),
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
    throw new Error(`Could not send Parallels scancode ${scanCode}: ${detail}`);
  }
}

// Escape any partially entered chat text, then type one fixed, non-chat command.
requireLiveBridge();
requireForegroundGame();
sendScanCode(1, 80);
for (const character of command) {
  sendScanCode(keyCodes[character]);
}
sendScanCode(28, 80);

console.log(JSON.stringify({
  status: "submitted",
  vm: vmName,
  command: "/addon reload agentbridge",
  bounded_key_events: command.length + 2,
}));
