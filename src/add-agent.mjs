import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "--") {
  cliArgs.shift();
}
const [id, localPortText, clientPortText = localPortText] = cliArgs;
const localPort = Number(localPortText);
const clientPort = Number(clientPortText);

if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
  console.error("Agent id must use 1-32 letters, numbers, underscores, or hyphens.");
  process.exit(2);
}
for (const [name, port] of [
  ["local port", localPort],
  ["client port", clientPort],
]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error(`${name} must be an integer from 1024 through 65535.`);
    process.exit(2);
  }
}

const runtimeDir = path.join(process.cwd(), "runtime");
const registryPath = path.join(runtimeDir, "agents.json");
if (!fs.existsSync(registryPath)) {
  console.error("Run ./scripts/init-agentbridge.sh before adding profiles.");
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
if (registry.agents[id]) {
  console.error(`Agent "${id}" already exists; rotate it manually as a coordinated change.`);
  process.exit(1);
}
for (const [existingId, settings] of Object.entries(registry.agents)) {
  if (Number(settings.port) === localPort) {
    console.error(`Local port ${localPort} is already assigned to agent "${existingId}".`);
    process.exit(1);
  }
}

const token = randomBytes(32).toString("hex");
registry.agents[id] = {
  host: "127.0.0.1",
  port: localPort,
  token,
};

fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
const temporaryPath = `${registryPath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
fs.renameSync(temporaryPath, registryPath);
fs.chmodSync(registryPath, 0o600);

const addonConfigPath = path.join(runtimeDir, `agentbridge-${id}.json`);
fs.writeFileSync(
  addonConfigPath,
  `${JSON.stringify(
    {
      bind_host: "127.0.0.1",
      bind_port: clientPort,
      token,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600, flag: "wx" },
);

console.log(`Added agent profile "${id}".`);
console.log(`Registry: ${registryPath}`);
console.log(`Copy as config.json for that isolated client: ${addonConfigPath}`);
console.log(
  `If the client is remote, forward Mac port ${localPort} to its loopback port ${clientPort}.`,
);
