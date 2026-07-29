import net from "node:net";
import { randomUUID } from "node:crypto";

export class BridgeError extends Error {
  constructor(message, code = "bridge_error") {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

export class BridgeClient {
  constructor({
    host = process.env.FFXI_BRIDGE_HOST || "127.0.0.1",
    port = Number(process.env.FFXI_BRIDGE_PORT || "19769"),
    token = process.env.FFXI_BRIDGE_TOKEN || "",
    timeoutMs = Number(process.env.FFXI_BRIDGE_TIMEOUT_MS || "3000"),
    maxResponseBytes = Number(process.env.FFXI_BRIDGE_MAX_RESPONSE_BYTES || "1048576"),
  } = {}) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = Math.min(Math.max(maxResponseBytes, 16384), 4 * 1024 * 1024);
  }

  async request(operation, params = {}) {
    if (!this.token) {
      throw new BridgeError(
        "FFXI_BRIDGE_TOKEN is not set. Configure the same token in the Ashita addon and MCP environment.",
        "missing_token",
      );
    }

    const requestId = randomUUID();
    const payload = JSON.stringify({
      id: requestId,
      operation,
      params,
      token: this.token,
    });
    if (Buffer.byteLength(payload, "utf8") > 16384) {
      throw new BridgeError(
        "Request exceeds the AgentBridge 16 KiB protocol limit.",
        "request_too_large",
      );
    }

    return await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let responseBuffer = "";
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        callback(value);
      };

      socket.setEncoding("utf8");
      socket.setTimeout(this.timeoutMs);

      socket.once("connect", () => {
        socket.write(`${payload}\n`);
      });

      socket.on("data", (chunk) => {
        responseBuffer += chunk;
        if (Buffer.byteLength(responseBuffer, "utf8") > this.maxResponseBytes) {
          finish(
            reject,
            new BridgeError(
              `Ashita bridge response exceeded ${this.maxResponseBytes} bytes.`,
              "response_too_large",
            ),
          );
          return;
        }
        const newline = responseBuffer.indexOf("\n");
        if (newline < 0) return;

        const line = responseBuffer.slice(0, newline);
        try {
          const response = JSON.parse(line);
          if (response.id !== requestId) {
            finish(
              reject,
              new BridgeError("Ashita bridge returned a mismatched response id.", "protocol_error"),
            );
            return;
          }
          if (!response.ok) {
            finish(
              reject,
              new BridgeError(response.error || "Ashita bridge rejected the request.", "remote_error"),
            );
            return;
          }
          finish(resolve, response.result);
        } catch (error) {
          finish(
            reject,
            new BridgeError(`Invalid JSON from Ashita bridge: ${error.message}`, "protocol_error"),
          );
        }
      });

      socket.once("timeout", () => {
        finish(
          reject,
          new BridgeError(
            `Timed out connecting to Ashita bridge at ${this.host}:${this.port}.`,
            "timeout",
          ),
        );
      });

      socket.once("error", (error) => {
        finish(
          reject,
          new BridgeError(
            `Cannot reach Ashita bridge at ${this.host}:${this.port}: ${error.message}`,
            "connection_error",
          ),
        );
      });

      socket.once("end", () => {
        if (!settled) {
          finish(
            reject,
            new BridgeError("Ashita bridge closed the connection without a response.", "connection_closed"),
          );
        }
      });
    });
  }
}

const SAFE_COMMANDS = [
  /^\/attack(?:\s|$)/i,
  /^\/attackoff(?:\s|$)/i,
  /^\/check(?:\s|$)/i,
  /^\/equip\s/i,
  /^\/follow(?:\s|$)/i,
  /^\/heal(?:\s|$)/i,
  /^\/item\s/i,
  /^\/ja\s/i,
  /^\/jobability\s/i,
  /^\/lockon(?:\s|$)/i,
  /^\/ma\s/i,
  /^\/magic\s/i,
  /^\/pet\s/i,
  /^\/ra(?:\s|$)/i,
  /^\/range(?:\s|$)/i,
  /^\/refa(?:\s|$)/i,
  /^\/ta\s/i,
  /^\/target\s/i,
  /^\/trade(?:\s|$)/i,
  /^\/weaponskill\s/i,
  /^\/ws\s/i,
];

export function validateGameplayCommand(command) {
  if (typeof command !== "string") {
    throw new BridgeError("Command must be a string.", "invalid_command");
  }

  const normalized = command.trim();
  if (!normalized || normalized.length > 200) {
    throw new BridgeError("Command must contain between 1 and 200 characters.", "invalid_command");
  }
  if (/[\r\n;|]/.test(normalized) || normalized.startsWith("!")) {
    throw new BridgeError(
      "Command chaining, control characters, and GM commands are blocked.",
      "unsafe_command",
    );
  }
  if (!SAFE_COMMANDS.some((pattern) => pattern.test(normalized))) {
    throw new BridgeError(
      "Command is outside the initial gameplay allowlist.",
      "unsafe_command",
    );
  }
  return normalized;
}
