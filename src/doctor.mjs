import { AgentRegistry } from "./agent-registry.mjs";

const args = new Set(process.argv.slice(2));
const serverOnly = args.has("--server-only");
const bridgeOnly = args.has("--bridge-only");

if (serverOnly && bridgeOnly) {
  console.error("Choose at most one of --server-only or --bridge-only.");
  process.exit(2);
}

const checks = [];

async function runCheck(name, action) {
  try {
    const detail = await action();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

await runCheck("node_runtime", async () => {
  const major = Number(process.versions.node.split(".", 1)[0]);
  if (major < 20) {
    throw new Error(`Node.js 20 or newer is required; found ${process.versions.node}.`);
  }
  return `Node.js ${process.versions.node}`;
});

if (!bridgeOnly) {
  await runCheck("landsandboat_api", async () => {
    const baseUrl = (process.env.LSB_API_URL || "http://127.0.0.1:8088/api").replace(
      /\/$/,
      "",
    );
    const [sessions, ips, zones] = await Promise.all([
      fetchJson(`${baseUrl}/sessions`),
      fetchJson(`${baseUrl}/ips`),
      fetchJson(`${baseUrl}/zones`),
    ]);
    return {
      url: baseUrl,
      sessions,
      unique_ips: ips,
      zone_slots: Array.isArray(zones) ? zones.length : null,
    };
  });
}

if (!serverOnly) {
  try {
    const registry = new AgentRegistry();
    for (const profile of registry.list().agents) {
      await runCheck(`agentbridge:${profile.id}`, async () => {
        const { value: state } = await registry.request(profile.id, "control_status");
        return {
          host: profile.host,
          port: profile.port,
          reachable: true,
          writes_enabled: state.enabled,
          auto_running: state.auto_running,
          movement_active: state.movement !== null && state.movement !== undefined,
        };
      });
    }
  } catch (error) {
    checks.push({
      name: "agent_registry",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const check of checks) {
  const marker = check.ok ? "PASS" : "FAIL";
  console.log(`${marker} ${check.name}: ${JSON.stringify(check.detail)}`);
}

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
