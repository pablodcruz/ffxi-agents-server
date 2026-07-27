import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AuditLogger } from "./audit-log.mjs";
import { BridgeClient, BridgeError } from "./bridge-client.mjs";

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function validateAgent(id, settings, clientFactory) {
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new BridgeError(
      `Invalid agent id "${id}"; use 1-32 letters, numbers, underscores, or hyphens.`,
      "invalid_agent_config",
    );
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new BridgeError(`Agent "${id}" must be a JSON object.`, "invalid_agent_config");
  }

  const host = settings.host || "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new BridgeError(
      `Agent "${id}" bridge host must remain loopback-only.`,
      "unsafe_agent_config",
    );
  }

  const port = Number(settings.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new BridgeError(
      `Agent "${id}" bridge port must be an integer from 1024 through 65535.`,
      "invalid_agent_config",
    );
  }

  if (typeof settings.token !== "string" || settings.token.length < 24) {
    throw new BridgeError(
      `Agent "${id}" requires a token of at least 24 characters.`,
      "invalid_agent_config",
    );
  }

  return {
    id,
    host,
    port,
    client: clientFactory({
      host,
      port,
      token: settings.token,
      timeoutMs: settings.timeout_ms,
    }),
  };
}

export class AgentRegistry {
  constructor({
    configPath = process.env.FFXI_AGENTS_CONFIG ||
      path.join(process.cwd(), "runtime", "agents.json"),
    env = process.env,
    clientFactory = (settings) => new BridgeClient(settings),
    auditLogger = new AuditLogger(),
  } = {}) {
    this.agents = new Map();
    this.writeQueues = new Map();
    this.auditLogger = auditLogger;

    if (fs.existsSync(configPath)) {
      const linkStatus = fs.lstatSync(configPath);
      if (!linkStatus.isFile() || linkStatus.isSymbolicLink()) {
        throw new BridgeError(
          "Agent registry must be a regular file, not a symlink.",
          "unsafe_agent_config",
        );
      }
      if (process.platform !== "win32" && (linkStatus.mode & 0o077) !== 0) {
        throw new BridgeError(
          "Agent registry permissions must not allow group or other access.",
          "unsafe_agent_config",
        );
      }
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (!config.agents || typeof config.agents !== "object" || Array.isArray(config.agents)) {
        throw new BridgeError(
          "Agent registry must contain an agents object.",
          "invalid_agent_config",
        );
      }
      for (const [id, settings] of Object.entries(config.agents)) {
        this.agents.set(id, validateAgent(id, settings, clientFactory));
      }
      this.defaultAgent = config.default_agent;
    } else {
      const id = env.FFXI_DEFAULT_AGENT || "primary";
      this.agents.set(
        id,
        validateAgent(
          id,
          {
            host: env.FFXI_BRIDGE_HOST || "127.0.0.1",
            port: Number(env.FFXI_BRIDGE_PORT || "19769"),
            token: env.FFXI_BRIDGE_TOKEN || "",
          },
          clientFactory,
        ),
      );
      this.defaultAgent = id;
    }

    if (this.agents.size === 0) {
      throw new BridgeError("Agent registry contains no agents.", "invalid_agent_config");
    }
    if (!this.defaultAgent || !this.agents.has(this.defaultAgent)) {
      throw new BridgeError(
        "default_agent must name one configured agent.",
        "invalid_agent_config",
      );
    }
  }

  list() {
    return {
      default_agent: this.defaultAgent,
      agents: [...this.agents.values()].map(({ id, host, port }) => ({
        id,
        host,
        port,
      })),
    };
  }

  resolve(agentId) {
    const id = agentId || this.defaultAgent;
    const agent = this.agents.get(id);
    if (!agent) {
      throw new BridgeError(`Unknown agent id "${id}".`, "unknown_agent");
    }
    return agent;
  }

  async request(agentId, operation, params = {}, { write = false, urgent = false } = {}) {
    const agent = this.resolve(agentId);
    const invoke = async () => {
      const startedAt = performance.now();
      try {
        const value = await agent.client.request(operation, params);
        if (write) {
          this.auditLogger.record({
            agentId: agent.id,
            operation,
            params,
            outcome: "ok",
            durationMs: performance.now() - startedAt,
          });
        }
        return { agentId: agent.id, value };
      } catch (error) {
        if (write) {
          this.auditLogger.record({
            agentId: agent.id,
            operation,
            params,
            outcome: "error",
            durationMs: performance.now() - startedAt,
            errorCode: error instanceof BridgeError ? error.code : "unexpected_error",
          });
        }
        throw error;
      }
    };

    if (!write || urgent) {
      return await invoke();
    }

    const previous = this.writeQueues.get(agent.id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(invoke);
    this.writeQueues.set(agent.id, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(agent.id) === current) {
        this.writeQueues.delete(agent.id);
      }
    }
  }

  async runExternalWrite(agentId, operation, params, callback, { urgent = false } = {}) {
    const agent = this.resolve(agentId);
    const invoke = async () => {
      const startedAt = performance.now();
      try {
        const value = await callback(agent.client);
        this.auditLogger.record({
          agentId: agent.id,
          operation,
          params,
          outcome: "ok",
          durationMs: performance.now() - startedAt,
        });
        return { agentId: agent.id, value };
      } catch (error) {
        this.auditLogger.record({
          agentId: agent.id,
          operation,
          params,
          outcome: "error",
          durationMs: performance.now() - startedAt,
          errorCode: error instanceof BridgeError ? error.code : "unexpected_error",
        });
        throw error;
      }
    };

    if (urgent) {
      return await invoke();
    }

    const previous = this.writeQueues.get(agent.id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(invoke);
    this.writeQueues.set(agent.id, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(agent.id) === current) {
        this.writeQueues.delete(agent.id);
      }
    }
  }
}
