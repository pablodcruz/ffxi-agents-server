#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectDir = path.resolve(import.meta.dirname, "..");
const runtimeDir = path.join(projectDir, "runtime", "forwarder-service");
const statePath = path.join(runtimeDir, "state.json");
const stdoutPath = path.join(runtimeDir, "forwarder.log");
const stderrPath = path.join(runtimeDir, "forwarder.error.log");
const scriptPath = fileURLToPath(import.meta.url);
const forwarderPath = path.join(projectDir, "scripts", "run-forwarder.sh");

function positivePid(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseForwarderState(text) {
  try {
    const value = JSON.parse(String(text || ""));
    return {
      schema_version: Number(value.schema_version) || 1,
      supervisor_pid: positivePid(value.supervisor_pid),
      child_pid: positivePid(value.child_pid),
      started_at: value.started_at || null,
      child_started_at: value.child_started_at || null,
      restarts: Math.max(0, Number(value.restarts) || 0),
    };
  } catch {
    return null;
  }
}

export function hasRequiredForwarderSockets(lines) {
  const values = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  return values.some((line) => /UDP/.test(line) && /:54230\b/.test(line))
    && [54001, 54002, 54230, 54231].every(
      (port) => values.some((line) => /TCP/.test(line) && line.includes(`:${port}`)),
    );
}

function ensureRuntimeDirectory() {
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(runtimeDir, 0o700);
  for (const logPath of [stdoutPath, stderrPath]) {
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, "", { mode: 0o600 });
    fs.chmodSync(logPath, 0o600);
  }
}

function readState() {
  if (!fs.existsSync(statePath)) return null;
  return parseForwarderState(fs.readFileSync(statePath, "utf8"));
}

function writeState(value) {
  ensureRuntimeDirectory();
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statePath);
  fs.chmodSync(statePath, 0o600);
}

function isAlive(pid) {
  if (!positivePid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function childSockets(pid) {
  if (!isAlive(pid)) return [];
  const result = spawnSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-i"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return String(result.stdout || "")
    .split(/\r?\n/)
    .filter((line) => /:(?:54001|54002|54230|54231)\b/.test(line));
}

function serviceStatus() {
  const state = readState();
  const supervisorAlive = isAlive(state?.supervisor_pid);
  const childAlive = isAlive(state?.child_pid);
  const sockets = childSockets(state?.child_pid);
  return {
    schema_version: 1,
    supervisor_pid: state?.supervisor_pid || null,
    child_pid: state?.child_pid || null,
    supervisor_alive: supervisorAlive,
    child_alive: childAlive,
    healthy: supervisorAlive && childAlive && hasRequiredForwarderSockets(sockets),
    socket_count: sockets.length,
    restarts: state?.restarts || 0,
    started_at: state?.started_at || null,
    child_started_at: state?.child_started_at || null,
    state_path: statePath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
  };
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let value = predicate();
  while (!value.healthy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = predicate();
  }
  return value;
}

async function supervise() {
  ensureRuntimeDirectory();
  let stopping = false;
  let child = null;
  let restarts = 0;
  const startedAt = new Date().toISOString();

  const requestStop = () => {
    stopping = true;
    if (child && isAlive(child.pid)) child.kill("SIGTERM");
  };
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);

  while (!stopping) {
    const stdoutFd = fs.openSync(stdoutPath, "a");
    const stderrFd = fs.openSync(stderrPath, "a");
    child = spawn(forwarderPath, [], {
      cwd: projectDir,
      env: process.env,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    writeState({
      schema_version: 1,
      supervisor_pid: process.pid,
      child_pid: child.pid,
      started_at: startedAt,
      child_started_at: new Date().toISOString(),
      restarts,
    });
    await new Promise((resolve) => child.once("exit", resolve));
    child = null;
    if (!stopping) {
      restarts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  writeState({
    schema_version: 1,
    supervisor_pid: process.pid,
    child_pid: null,
    started_at: startedAt,
    child_started_at: null,
    restarts,
  });
}

async function startService() {
  ensureRuntimeDirectory();
  let status = serviceStatus();
  if (status.healthy) return { action: "start", disposition: "already_running", ...status };
  if (status.supervisor_alive) {
    status = await waitFor(serviceStatus);
    if (status.healthy) return { action: "start", disposition: "recovered", ...status };
    throw new Error("The detached forwarder supervisor is alive but its child did not recover.");
  }

  const stdoutFd = fs.openSync(stdoutPath, "a");
  const stderrFd = fs.openSync(stderrPath, "a");
  const supervisor = spawn(process.execPath, [scriptPath, "--action", "supervise"], {
    cwd: projectDir,
    detached: true,
    env: process.env,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  supervisor.unref();
  status = await waitFor(serviceStatus);
  if (!status.healthy) {
    throw new Error(`Detached forwarder did not bind all private game ports; inspect ${stderrPath}.`);
  }
  return { action: "start", disposition: "started", ...status };
}

async function stopService() {
  const before = serviceStatus();
  if (before.supervisor_alive) process.kill(before.supervisor_pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  let after = serviceStatus();
  while ((after.supervisor_alive || after.child_alive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    after = serviceStatus();
  }
  return {
    action: "stop",
    disposition: before.supervisor_alive ? "stopped" : "already_stopped",
    ...after,
  };
}

async function main() {
  const actionIndex = process.argv.indexOf("--action");
  const action = actionIndex >= 0 ? process.argv[actionIndex + 1] : "status";
  if (action === "supervise") {
    await supervise();
    return;
  }
  let result;
  if (action === "start") result = await startService();
  else if (action === "stop") result = await stopService();
  else if (action === "status") result = { action: "status", ...serviceStatus() };
  else throw new Error("--action must be start, status, stop, or supervise.");
  console.log(JSON.stringify(result, null, 2));
  if (action !== "stop" && !result.healthy) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
