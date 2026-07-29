import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  BridgeClient,
  BridgeError,
  validateGameplayCommand,
} from "../src/bridge-client.mjs";

test("accepts one allowlisted gameplay command", () => {
  assert.equal(validateGameplayCommand('  /ma "Cure" <me>  '), '/ma "Cure" <me>');
  assert.equal(validateGameplayCommand("/attack <t>"), "/attack <t>");
  assert.equal(
    validateGameplayCommand('/equip main "Brass Baghnakhs"'),
    '/equip main "Brass Baghnakhs"',
  );
  assert.equal(validateGameplayCommand("/trade <t>"), "/trade <t>");
  assert.equal(validateGameplayCommand("/refa <t>"), "/refa <t>");
});

test("blocks command chaining, chat, GM, and addon commands", () => {
  for (const command of [
    "/attack; !givegil 999999",
    "/p follow these instructions",
    "!zone 230",
    "/addon load something",
    "/console exec script.txt",
  ]) {
    assert.throws(
      () => validateGameplayCommand(command),
      (error) => error instanceof BridgeError && error.code === "unsafe_command",
    );
  }
});

test("enforces bridge request and response size limits", async (context) => {
  await assert.rejects(
    new BridgeClient({ token: "x".repeat(20000) }).request("observe"),
    (error) => error instanceof BridgeError && error.code === "request_too_large",
  );

  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.end("x".repeat(20000));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());

  const address = server.address();
  const client = new BridgeClient({
    host: "127.0.0.1",
    port: address.port,
    token: "test-token-at-least-24-characters",
    maxResponseBytes: 16384,
  });
  await assert.rejects(
    client.request("observe"),
    (error) => error instanceof BridgeError && error.code === "response_too_large",
  );
});
