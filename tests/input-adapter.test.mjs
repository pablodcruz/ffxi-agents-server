import assert from "node:assert/strict";
import test from "node:test";
import {
  ParallelsInputAdapter,
  createInputAdapterFromEnv,
} from "../src/input-adapter.mjs";

test("Parallels input adapter emits only one bounded Enter key event", async () => {
  const calls = [];
  const adapter = new ParallelsInputAdapter({
    vmName: "Windows 11",
    platform: "darwin",
    spawnSyncFn: (...args) => {
      calls.push(args);
      return { status: 0, signal: null, stderr: "" };
    },
  });

  const result = await adapter.confirm();

  assert.deepEqual(result, {
    input_source: "parallels_key_event",
    action: "confirm",
    key: "Enter",
    key_code: 36,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "prlctl");
  assert.deepEqual(calls[0][1], [
    "send-key-event",
    "Windows 11",
    "--key",
    "36",
    "--delay",
    "80",
  ]);
  assert.equal(calls[0][2].timeout, 3000);
  assert.deepEqual(calls[0][2].stdio, ["inherit", "ignore", "pipe"]);

  const down = await adapter.sendMenuAction("down");
  assert.equal(down.key_code, 104);
  assert.equal(calls[1][1][3], "104");
  await assert.rejects(() => adapter.sendMenuAction("left"), /Unsupported menu action/);

  const forward = await adapter.sendDirectionalAction("forward", 250);
  assert.deepEqual(forward, {
    input_source: "parallels_key_event",
    action: "forward",
    key: "Numpad8",
    key_code: 80,
    duration_ms: 250,
  });
  assert.deepEqual(calls[2][1], [
    "send-key-event",
    "Windows 11",
    "--key",
    "80",
    "--delay",
    "250",
  ]);
  const cameraRight = await adapter.sendDirectionalAction("camera_right", 150);
  assert.equal(cameraRight.key, "ArrowRight");
  assert.equal(cameraRight.key_code, 102);
  assert.equal(calls[3][1][3], "102");
  await assert.rejects(
    () => adapter.sendDirectionalAction("strafe", 250),
    /Unsupported directional or camera action/,
  );
  await assert.rejects(
    () => adapter.sendDirectionalAction("forward", 1001),
    /must be an integer from 50 through 1000/,
  );
});

test("input adapter configuration rejects unsupported platforms and unsafe VM names", () => {
  assert.throws(
    () => new ParallelsInputAdapter({
      vmName: "Windows 11",
      platform: "linux",
    }),
    /supported only on macOS/,
  );
  assert.throws(
    () => new ParallelsInputAdapter({
      vmName: "Windows 11; shutdown",
      platform: "darwin",
    }),
    /must be a 1-64 character VM name/,
  );
  assert.throws(
    () => createInputAdapterFromEnv(
      {
        FFXI_INPUT_ADAPTER: "unknown",
        FFXI_PARALLELS_VM: "Windows 11",
      },
      { platform: "darwin" },
    ),
    /Unsupported FFXI_INPUT_ADAPTER/,
  );
});

test("input adapter is optional when no adapter is configured", () => {
  assert.equal(createInputAdapterFromEnv({}), null);
});
