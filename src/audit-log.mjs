import fs from "node:fs";
import path from "node:path";

function boundedParams(value, depth = 0) {
  if (depth > 4) return "[depth-limit]";
  if (typeof value === "string") {
    return value.length <= 256 ? value : `${value.slice(0, 256)}…`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((entry) => boundedParams(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|password|secret|credential/i.test(key))
        .slice(0, 32)
        .map(([key, entry]) => [key, boundedParams(entry, depth + 1)]),
    );
  }
  return String(value);
}

export class AuditLogger {
  constructor({
    filePath = process.env.FFXI_AUDIT_LOG ||
      path.join(process.cwd(), "runtime", "audit", "agent-actions.jsonl"),
    clock = () => new Date(),
  } = {}) {
    this.filePath = filePath;
    this.clock = clock;
  }

  record({ agentId, operation, params, outcome, durationMs, errorCode }) {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(directory, 0o700);
    }

    const entry = {
      timestamp: this.clock().toISOString(),
      agent_id: agentId,
      operation,
      params: boundedParams(params),
      outcome,
      duration_ms: Math.round(durationMs),
    };
    if (errorCode) entry.error_code = errorCode;

    const descriptor = fs.openSync(
      this.filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY,
      0o600,
    );
    try {
      fs.writeSync(descriptor, `${JSON.stringify(entry)}\n`);
    } finally {
      fs.closeSync(descriptor);
    }
    if (process.platform !== "win32") {
      fs.chmodSync(this.filePath, 0o600);
    }
  }
}
