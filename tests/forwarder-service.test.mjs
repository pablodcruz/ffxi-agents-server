import assert from "node:assert/strict";
import test from "node:test";
import {
  hasRequiredForwarderSockets,
  parseForwarderState,
} from "../scripts/forwarder-service.mjs";

test("forwarder state parser accepts only positive process IDs", () => {
  assert.deepEqual(parseForwarderState(JSON.stringify({
    schema_version: 1,
    supervisor_pid: 123,
    child_pid: -4,
    restarts: 2,
  })), {
    schema_version: 1,
    supervisor_pid: 123,
    child_pid: null,
    started_at: null,
    child_started_at: null,
    restarts: 2,
  });
  assert.equal(parseForwarderState("not-json"), null);
});

test("forwarder socket health requires all TCP listeners and map UDP", () => {
  const sockets = [
    "node 10u IPv4 TCP 10.211.55.2:54001 (LISTEN)",
    "node 11u IPv4 TCP 10.211.55.2:54002 (LISTEN)",
    "node 12u IPv4 TCP 10.211.55.2:54230 (LISTEN)",
    "node 13u IPv4 TCP 10.211.55.2:54231 (LISTEN)",
    "node 14u IPv4 UDP 10.211.55.2:54230",
  ];
  assert.equal(hasRequiredForwarderSockets(sockets), true);
  assert.equal(hasRequiredForwarderSockets(sockets.slice(0, -1)), false);
  assert.equal(hasRequiredForwarderSockets(sockets.filter((line) => !line.includes(54002))), false);
});
