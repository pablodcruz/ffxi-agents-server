import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import test from "node:test";
import { startPrivateInterfaceForwarder } from "../src/private-interface-forwarder.mjs";

function listenTcp(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function bindUdp(socket) {
  return new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
}

test("forwards bounded TCP and UDP traffic only to loopback", async (context) => {
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
    logger: { error() {} },
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
