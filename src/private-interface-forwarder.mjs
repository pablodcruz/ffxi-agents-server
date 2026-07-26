import dgram from "node:dgram";
import net from "node:net";
import { pathToFileURL } from "node:url";

const DEFAULT_TCP_PORTS = [54001, 54002, 54230, 54231];
const DEFAULT_UDP_PORTS = [54230];
const MAX_UDP_PACKET_BYTES = 65507;

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function normalizeMappings(values, { allowEphemeral = false } = {}) {
  return values.map((value) => {
    const mapping =
      typeof value === "number"
        ? { listenPort: value, targetPort: value }
        : { listenPort: value.listenPort, targetPort: value.targetPort };
    for (const [name, port] of Object.entries(mapping)) {
      const minimum = allowEphemeral && name === "listenPort" ? 0 : 1;
      if (!Number.isInteger(port) || port < minimum || port > 65535) {
        throw new Error(`${name} must be an integer between ${minimum} and 65535.`);
      }
    }
    return mapping;
  });
}

function listenTcp(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });
}

function bindUdp(socket, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind({ address: host, port, exclusive: true });
  });
}

export async function startPrivateInterfaceForwarder({
  listenHost,
  targetHost = "127.0.0.1",
  tcpMappings = DEFAULT_TCP_PORTS,
  udpMappings = DEFAULT_UDP_PORTS,
  maxTcpConnections = 32,
  maxUdpPeers = 16,
  idleTimeoutMs = 120_000,
  allowLoopbackForTests = false,
  allowEphemeralPortsForTests = false,
  logger = console,
} = {}) {
  if (!net.isIPv4(listenHost)) {
    throw new Error("FFXI_FORWARD_LISTEN_HOST must be an explicit IPv4 address.");
  }
  if (!isPrivateIpv4(listenHost) && !(allowLoopbackForTests && listenHost === "127.0.0.1")) {
    throw new Error("The forwarder only binds an RFC1918 private IPv4 address.");
  }
  if (targetHost !== "127.0.0.1") {
    throw new Error("The forwarder target is restricted to 127.0.0.1.");
  }
  if (!Number.isInteger(maxTcpConnections) || maxTcpConnections < 1 || maxTcpConnections > 256) {
    throw new Error("maxTcpConnections must be between 1 and 256.");
  }
  if (!Number.isInteger(maxUdpPeers) || maxUdpPeers < 1 || maxUdpPeers > 64) {
    throw new Error("maxUdpPeers must be between 1 and 64.");
  }

  const normalizedTcp = normalizeMappings(tcpMappings, {
    allowEphemeral: allowEphemeralPortsForTests,
  });
  const normalizedUdp = normalizeMappings(udpMappings, {
    allowEphemeral: allowEphemeralPortsForTests,
  });
  const tcpServers = [];
  const tcpSockets = new Set();
  const udpListeners = [];
  const udpPeers = new Set();
  let activeTcpConnections = 0;

  try {
    for (const mapping of normalizedTcp) {
      const server = net.createServer((client) => {
        if (activeTcpConnections >= maxTcpConnections) {
          client.destroy();
          return;
        }

        activeTcpConnections += 1;
        const upstream = net.createConnection({
          host: targetHost,
          port: mapping.targetPort,
        });
        const sockets = [client, upstream];
        sockets.forEach((socket) => {
          tcpSockets.add(socket);
          socket.setTimeout(idleTimeoutMs);
          socket.once("timeout", () => socket.destroy());
        });

        const finish = () => {
          sockets.forEach((socket) => {
            tcpSockets.delete(socket);
            if (!socket.destroyed) socket.destroy();
          });
        };
        client.once("close", () => {
          activeTcpConnections = Math.max(0, activeTcpConnections - 1);
          finish();
        });
        client.once("error", finish);
        upstream.once("error", finish);
        upstream.once("connect", () => {
          client.pipe(upstream);
          upstream.pipe(client);
        });
      });
      server.on("error", (error) => logger.error(`TCP forwarder error: ${error.message}`));
      await listenTcp(server, listenHost, mapping.listenPort);
      tcpServers.push({ server, mapping });
    }

    for (const mapping of normalizedUdp) {
      const listener = dgram.createSocket("udp4");
      const peers = new Map();

      listener.on("message", (message, remote) => {
        if (message.length > MAX_UDP_PACKET_BYTES) return;
        const key = `${remote.address}:${remote.port}`;
        let peer = peers.get(key);
        if (!peer) {
          if (peers.size >= maxUdpPeers) return;
          const upstream = dgram.createSocket("udp4");
          peer = { upstream, remote, lastSeen: Date.now() };
          peers.set(key, peer);
          udpPeers.add(upstream);
          upstream.on("message", (response) => {
            listener.send(response, peer.remote.port, peer.remote.address);
          });
          upstream.on("error", (error) => {
            logger.error(`UDP upstream error: ${error.message}`);
            peers.delete(key);
            udpPeers.delete(upstream);
            upstream.close();
          });
        }
        peer.lastSeen = Date.now();
        peer.remote = remote;
        peer.upstream.send(message, mapping.targetPort, targetHost);
      });
      listener.on("error", (error) => logger.error(`UDP forwarder error: ${error.message}`));

      const cleanup = setInterval(() => {
        const cutoff = Date.now() - idleTimeoutMs;
        for (const [key, peer] of peers) {
          if (peer.lastSeen < cutoff) {
            peers.delete(key);
            udpPeers.delete(peer.upstream);
            peer.upstream.close();
          }
        }
      }, Math.min(idleTimeoutMs, 30_000));
      cleanup.unref();

      await bindUdp(listener, listenHost, mapping.listenPort);
      udpListeners.push({ listener, mapping, cleanup, peers });
    }
  } catch (error) {
    tcpSockets.forEach((socket) => socket.destroy());
    tcpServers.forEach(({ server }) => server.close());
    udpPeers.forEach((socket) => socket.close());
    udpListeners.forEach(({ listener, cleanup }) => {
      clearInterval(cleanup);
      listener.close();
    });
    throw error;
  }

  const addresses = {
    listen_host: listenHost,
    target_host: targetHost,
    tcp: tcpServers.map(({ server, mapping }) => ({
      listen_port: server.address().port,
      target_port: mapping.targetPort,
    })),
    udp: udpListeners.map(({ listener, mapping }) => ({
      listen_port: listener.address().port,
      target_port: mapping.targetPort,
    })),
  };

  return {
    addresses,
    async close() {
      tcpSockets.forEach((socket) => socket.destroy());
      udpPeers.forEach((socket) => socket.close());
      await Promise.all([
        ...tcpServers.map(
          ({ server }) =>
            new Promise((resolve) => {
              server.close(resolve);
            }),
        ),
        ...udpListeners.map(
          ({ listener, cleanup }) =>
            new Promise((resolve) => {
              clearInterval(cleanup);
              listener.close(resolve);
            }),
        ),
      ]);
    },
  };
}

async function main() {
  const listenHost = process.env.FFXI_FORWARD_LISTEN_HOST || "";
  const forwarder = await startPrivateInterfaceForwarder({ listenHost });
  console.log(JSON.stringify({ status: "ready", ...forwarder.addresses }));

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await forwarder.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
