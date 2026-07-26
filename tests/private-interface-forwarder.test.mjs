import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import test from "node:test";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_UDP_INITIAL_RETRY_MS,
  startPrivateInterfaceForwarder,
} from "../src/private-interface-forwarder.mjs";

function listenTcp(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function bindUdp(socket) {
  return new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
}

test("keeps the default auth connection open long enough for interactive login", () => {
  assert.equal(DEFAULT_IDLE_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(DEFAULT_UDP_INITIAL_RETRY_MS, 1000);
});

test("forwards bounded TCP and UDP traffic only to loopback", async (context) => {
  const infoMessages = [];
  const tcpTarget = net.createServer((socket) => socket.pipe(socket));
  await listenTcp(tcpTarget);
  context.after(() => tcpTarget.close());

  const udpTarget = dgram.createSocket("udp4");
  udpTarget.on("message", (message, remote) => {
    udpTarget.send(message, remote.port, remote.address);
  });
  await bindUdp(udpTarget);
  context.after(() => udpTarget.close());

  const forwarder = await startPrivateInterfaceForwarder({
    listenHost: "127.0.0.1",
    tcpMappings: [{ listenPort: 0, targetPort: tcpTarget.address().port }],
    udpMappings: [{ listenPort: 0, targetPort: udpTarget.address().port }],
    allowLoopbackForTests: true,
    allowEphemeralPortsForTests: true,
    idleTimeoutMs: 1000,
    logger: {
      error() {},
      info(message) {
        infoMessages.push(message);
      },
    },
  });
  context.after(() => forwarder.close());

  const tcpResponse = await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: forwarder.addresses.tcp[0].listen_port,
    });
    socket.setEncoding("utf8");
    socket.setTimeout(1000);
    socket.once("connect", () => socket.write("tcp-ok"));
    socket.once("data", (value) => {
      socket.destroy();
      resolve(value);
    });
    socket.once("timeout", () => reject(new Error("TCP forwarder timed out.")));
    socket.once("error", reject);
  });
  assert.equal(tcpResponse, "tcp-ok");
  assert.equal(forwarder.addresses.idle_timeout_ms, 1000);
  assert.equal(forwarder.addresses.udp_initial_retry_ms, DEFAULT_UDP_INITIAL_RETRY_MS);

  const udpClient = dgram.createSocket("udp4");
  context.after(() => udpClient.close());
  const udpResponse = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("UDP forwarder timed out.")), 1000);
    udpClient.once("message", (value) => {
      clearTimeout(timeout);
      resolve(value.toString("utf8"));
    });
    udpClient.send(
      "udp-ok",
      forwarder.addresses.udp[0].listen_port,
      forwarder.addresses.listen_host,
    );
  });
  assert.equal(udpResponse, "udp-ok");
  assert.match(infoMessages[0], /^UDP peer 127\.0\.0\.1:\d+ forwarding to 127\.0\.0\.1:\d+\.$/);
  assert.match(infoMessages[1], /^UDP reply path active for 127\.0\.0\.1:\d+ \(6 bytes from 127\.0\.0\.1:\d+\)\.$/);

  await assert.rejects(
    startPrivateInterfaceForwarder({
      listenHost: "0.0.0.0",
      tcpMappings: [],
      udpMappings: [],
    }),
    /RFC1918 private IPv4/,
  );
  await assert.rejects(
    startPrivateInterfaceForwarder({
      listenHost: "10.0.0.2",
      targetHost: "10.0.0.3",
      tcpMappings: [],
      udpMappings: [],
    }),
    /target is restricted to 127\.0\.0\.1/,
  );
});

test("retries the first UDP datagram once when the upstream is not ready", async (context) => {
  let receivedDatagrams = 0;
  const infoMessages = [];
  const udpTarget = dgram.createSocket("udp4");
  udpTarget.on("message", (message, remote) => {
    receivedDatagrams += 1;
    if (receivedDatagrams === 2) {
      udpTarget.send(message, remote.port, remote.address);
    }
  });
  await bindUdp(udpTarget);
  context.after(() => udpTarget.close());

  const forwarder = await startPrivateInterfaceForwarder({
    listenHost: "127.0.0.1",
    tcpMappings: [],
    udpMappings: [{ listenPort: 0, targetPort: udpTarget.address().port }],
    allowLoopbackForTests: true,
    allowEphemeralPortsForTests: true,
    idleTimeoutMs: 1000,
    udpInitialRetryMs: 25,
    logger: {
      error() {},
      info(message) {
        infoMessages.push(message);
      },
    },
  });
  context.after(() => forwarder.close());

  const udpClient = dgram.createSocket("udp4");
  context.after(() => udpClient.close());
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Retried UDP forwarder timed out.")),
      1000,
    );
    udpClient.once("message", (value) => {
      clearTimeout(timeout);
      resolve(value.toString("utf8"));
    });
    udpClient.send(
      "retry-ok",
      forwarder.addresses.udp[0].listen_port,
      forwarder.addresses.listen_host,
    );
  });

  assert.equal(response, "retry-ok");
  assert.equal(receivedDatagrams, 2);
  assert.equal(
    infoMessages.filter((message) => message.startsWith("Retrying initial UDP datagram"))
      .length,
    1,
  );
});

test("refuses a Darwin-style UDP forward when the target has no listener", async () => {
  const reservation = dgram.createSocket("udp4");
  await bindUdp(reservation);
  const unusedPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));

  await assert.rejects(
    startPrivateInterfaceForwarder({
      listenHost: "127.0.0.1",
      tcpMappings: [],
      udpMappings: [{ listenPort: 0, targetPort: unusedPort }],
      verifyUdpTargetListeners: true,
      allowLoopbackForTests: true,
      allowEphemeralPortsForTests: true,
    }),
    /No UDP listener is bound.*grpc port forwarder/,
  );
});
