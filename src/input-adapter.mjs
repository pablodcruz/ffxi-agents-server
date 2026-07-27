import { spawnSync } from "node:child_process";
import { BridgeError } from "./bridge-client.mjs";

const VM_NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,64}$/;
const MENU_KEYS = Object.freeze({
  cancel: { key: "Escape", keyCode: 9 },
  confirm: { key: "Enter", keyCode: 36 },
  down: { key: "Down", keyCode: 104 },
  up: { key: "Up", keyCode: 98 },
});
const DIRECTION_KEYS = Object.freeze({
  backward: { key: "Numpad2", keyCode: 88 },
  camera_left: { key: "ArrowLeft", keyCode: 100 },
  camera_right: { key: "ArrowRight", keyCode: 102 },
  forward: { key: "Numpad8", keyCode: 80 },
  turn_left: { key: "Numpad4", keyCode: 83 },
  turn_right: { key: "Numpad6", keyCode: 85 },
});

export class ParallelsInputAdapter {
  constructor({
    vmName,
    platform = process.platform,
    spawnSyncFn = spawnSync,
  }) {
    if (platform !== "darwin") {
      throw new BridgeError(
        "The Parallels input adapter is supported only on macOS.",
        "unsupported_input_adapter",
      );
    }
    if (!VM_NAME_PATTERN.test(vmName || "")) {
      throw new BridgeError(
        "FFXI_PARALLELS_VM must be a 1-64 character VM name using letters, numbers, spaces, dot, underscore, or hyphen.",
        "invalid_input_adapter",
      );
    }
    this.vmName = vmName;
    this.spawnSyncFn = spawnSyncFn;
  }

  async sendMenuAction(action) {
    const mapping = MENU_KEYS[action];
    if (!mapping) {
      throw new BridgeError(
        `Unsupported menu action "${action}".`,
        "invalid_menu_action",
      );
    }
    const child = this.spawnSyncFn(
      "prlctl",
      [
        "send-key-event",
        this.vmName,
        "--key",
        String(mapping.keyCode),
        "--delay",
        "80",
      ],
      {
        timeout: 3000,
        stdio: ["inherit", "ignore", "pipe"],
        encoding: "utf8",
      },
    );
    if (child.error || child.status !== 0) {
      const detail = child.error?.message || child.stderr?.trim() || `exit ${child.status}`;
      throw new BridgeError(
        `Parallels could not send the bounded confirm input: ${detail}`,
        "input_adapter_error",
      );
    }

    return {
      input_source: "parallels_key_event",
      action,
      key: mapping.key,
      key_code: mapping.keyCode,
    };
  }

  async sendDirectionalAction(action, durationMs) {
    const mapping = DIRECTION_KEYS[action];
    if (!mapping) {
      throw new BridgeError(
        `Unsupported directional or camera action "${action}".`,
        "invalid_directional_action",
      );
    }
    if (!Number.isInteger(durationMs) || durationMs < 50 || durationMs > 1000) {
      throw new BridgeError(
        "Directional input duration must be an integer from 50 through 1000 milliseconds.",
        "invalid_directional_duration",
      );
    }

    const child = this.spawnSyncFn(
      "prlctl",
      [
        "send-key-event",
        this.vmName,
        "--key",
        String(mapping.keyCode),
        "--delay",
        String(durationMs),
      ],
      {
        timeout: 3000,
        stdio: ["inherit", "ignore", "pipe"],
        encoding: "utf8",
      },
    );
    if (child.error || child.status !== 0) {
      const detail = child.error?.message || child.stderr?.trim() || `exit ${child.status}`;
      throw new BridgeError(
        `Parallels could not send the bounded directional input: ${detail}`,
        "input_adapter_error",
      );
    }

    return {
      input_source: "parallels_key_event",
      action,
      key: mapping.key,
      key_code: mapping.keyCode,
      duration_ms: durationMs,
    };
  }

  async confirm() {
    return await this.sendMenuAction("confirm");
  }
}

export function createInputAdapterFromEnv(env = process.env, options = {}) {
  const name = env.FFXI_INPUT_ADAPTER?.trim().toLowerCase();
  if (!name) return null;
  if (name !== "parallels") {
    throw new BridgeError(
      `Unsupported FFXI_INPUT_ADAPTER "${name}".`,
      "unsupported_input_adapter",
    );
  }
  return new ParallelsInputAdapter({
    vmName: env.FFXI_PARALLELS_VM,
    ...options,
  });
}
