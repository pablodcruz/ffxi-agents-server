import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const FARM_CONFIRMATION = "ARM PRIVATE SERVER FARM SUPERVISOR";

const agentPattern = /^[A-Za-z0-9_-]{1,32}$/;

function pathsFor(projectDir, agentId) {
  const directory = path.join(projectDir, "runtime", "farm-supervisor");
  return {
    directory,
    state: path.join(directory, `${agentId}.json`),
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function publicState(state) {
  if (!state) {
    return {
      status: "idle",
      active: false,
    };
  }
  const heartbeatAgeMs = Date.now() - Number(state.heartbeat_at_ms || 0);
  const active = ["starting", "running", "stopping"].includes(state.status)
    && heartbeatAgeMs <= 5000;
  return {
    ...state,
    active,
    heartbeat_age_ms: heartbeatAgeMs,
    pid: undefined,
  };
}

export async function farmStatus({ projectDir, agentId = "primary" }) {
  if (!agentPattern.test(agentId)) throw new Error("Invalid agent id.");
  const paths = pathsFor(projectDir, agentId);
  return publicState(await readJson(paths.state));
}

export function farmSupervisorArgs({
  projectDir,
  agentId,
  leaseId,
  zoneId,
  maximumSeconds,
  maximumFights,
  scanRadius,
  minimumStartHpPercent,
  allowCaution,
  weaponSkill,
}) {
  return [
    path.join(projectDir, "scripts", "mcp-farm-supervisor.mjs"),
    "--agent-id", agentId,
    "--lease-id", leaseId,
    "--zone-id", String(zoneId),
    "--maximum-seconds", String(maximumSeconds),
    "--maximum-fights", String(maximumFights),
    "--scan-radius", String(scanRadius),
    "--minimum-start-hp-percent", String(minimumStartHpPercent),
    "--allow-caution", String(Boolean(allowCaution)),
    "--weapon-skill", weaponSkill,
    "--confirmation", FARM_CONFIRMATION,
  ];
}

export async function startFarm({
  projectDir,
  agentId = "primary",
  zoneId,
  maximumSeconds = 900,
  maximumFights = 30,
  scanRadius = 50,
  minimumStartHpPercent = 90,
  allowCaution = false,
  weaponSkill = "Combo",
  confirmation,
}) {
  if (confirmation !== FARM_CONFIRMATION) {
    throw new Error(`Farm start requires confirmation: ${FARM_CONFIRMATION}`);
  }
  if (!agentPattern.test(agentId)) throw new Error("Invalid agent id.");
  const current = await farmStatus({ projectDir, agentId });
  if (current.active) {
    throw new Error(`Farm lease ${current.lease_id} is already active.`);
  }

  const leaseId = randomUUID();
  const paths = pathsFor(projectDir, agentId);
  await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await fs.chmod(paths.directory, 0o700);
  const logPath = path.join(paths.directory, `${leaseId}.log`);
  const logHandle = await fs.open(logPath, "a", 0o600);
  const initial = {
    schema_version: 1,
    agent_id: agentId,
    lease_id: leaseId,
    pid: null,
    status: "starting",
    phase: "starting",
    started_at: new Date().toISOString(),
    heartbeat_at_ms: Date.now(),
    log_path: logPath,
    config: {
      zone_id: zoneId,
      maximum_seconds: maximumSeconds,
      maximum_fights: maximumFights,
      scan_radius: scanRadius,
      minimum_start_hp_percent: minimumStartHpPercent,
      allow_caution: Boolean(allowCaution),
      weapon_skill: weaponSkill,
    },
    counters: {
      fights_completed: 0,
      proactive_engagements: 0,
      reactive_engagements: 0,
      multi_target_handoffs: 0,
      weapon_skills: 0,
      recoveries: 0,
      deaths: 0,
      home_point_returns: 0,
      gil_earned: 0,
      exp_earned: 0,
      excluded_pulls: 0,
      attack_rejections: 0,
      target_cycle_errors: 0,
      teleport_while_engaged: 0,
      recovery_while_engaged: 0,
    },
  };
  await fs.writeFile(paths.state, `${JSON.stringify(initial, null, 2)}\n`, {
    mode: 0o600,
  });

  const args = farmSupervisorArgs({
    projectDir,
    agentId,
    leaseId,
    zoneId,
    maximumSeconds,
    maximumFights,
    scanRadius,
    minimumStartHpPercent,
    allowCaution,
    weaponSkill,
  });
  const child = spawn(process.execPath, args, {
    cwd: projectDir,
    env: process.env,
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });
  child.unref();
  await logHandle.close();

  const stateAfterSpawn = await readJson(paths.state);
  if (
    stateAfterSpawn?.lease_id === leaseId
    && stateAfterSpawn?.status === "starting"
  ) {
    await fs.writeFile(paths.state, `${JSON.stringify({
      ...stateAfterSpawn,
      pid: child.pid,
      heartbeat_at_ms: Date.now(),
    }, null, 2)}\n`, { mode: 0o600 });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await farmStatus({ projectDir, agentId });
    if (status.lease_id === leaseId && status.status !== "starting") return status;
  }
  return farmStatus({ projectDir, agentId });
}

export async function stopFarm({
  projectDir,
  agentId = "primary",
  leaseId,
}) {
  if (!agentPattern.test(agentId)) throw new Error("Invalid agent id.");
  const current = await farmStatus({ projectDir, agentId });
  if (!current.active) return current;
  if (leaseId && current.lease_id !== leaseId) {
    throw new Error("Farm stop lease id does not match the active lease.");
  }
  const paths = pathsFor(projectDir, agentId);
  const stopPath = path.join(paths.directory, `${current.lease_id}.stop`);
  await fs.writeFile(stopPath, `${new Date().toISOString()}\n`, { mode: 0o600 });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await farmStatus({ projectDir, agentId });
    if (!status.active) return status;
  }
  return {
    ...(await farmStatus({ projectDir, agentId })),
    stop_requested: true,
  };
}
