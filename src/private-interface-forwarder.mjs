import dgram from "node:dgram";
import net from "node:net";
import { pathToFileURL } from "node:url";

const DEFAULT_TCP_PORTS = [54001, 54002, 54230, 54231];
const DEFAULT_UDP_PORTS = [54230];
const MAX_UDP_PACKET_BYTES = 65507;
export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_UDP_INITIAL_RETRY_MS = 1000;

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

function requireUdpTargetListener(host, port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (error) => {
      socket.close();
      if (error.code === "EADDRINUSE") {
        resolve();
        return;
      }
      reject(error);
    });
    socket.once("listening", () => {
      socket.close(() => {
        reject(
          new Error(
            `No UDP listener is bound to ${host}:${port}. On Colima for macOS, use the grpc port forwarder because ssh supports TCP only.`,
          ),
        );
      });
    });
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
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  udpInitialRetryMs = DEFAULT_UDP_INITIAL_RETRY_MS,
  verifyUdpTargetListeners = process.platform === "darwin",
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
  if (
    !Number.isInteger(udpInitialRetryMs) ||
    udpInitialRetryMs < 0 ||
    udpInitialRetryMs > 5000
  ) {
    throw new Error("udpInitialRetryMs must be between 0 and 5000 milliseconds.");
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

  if (verifyUdpTargetListeners) {
    for (const mapping of normalizedUdp) {
      await requireUdpTargetListener(targetHost, mapping.targetPort);
    }
  }

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
          peer = {
            upstream,
            remote,
            lastSeen: Date.now(),
            clientDatagrams: 0,
            upstreamDatagrams: 0,
            initialRetryTimer: null,
          };
          peers.set(key, peer);
          udpPeers.add(upstream);
          upstream.on("message", (response) => {
            peer.upstreamDatagrams += 1;
            if (peer.initialRetryTimer) {
              clearTimeout(peer.initialRetryTimer);
              peer.initialRetryTimer = null;
            }
            if (peer.upstreamDatagrams === 1) {
              logger.info?.(
                `UDP reply path active for ${key} (${response.length} bytes from ${targetHost}:${mapping.targetPort}).`,
              );
            }
            listener.send(response, peer.remote.port, peer.remote.address, (error) => {
              if (error) {
                logger.error(`UDP client send error for ${key}: ${error.message}`);
              }
            });
          });
          upstream.on("error", (error) => {
            logger.error(`UDP upstream error: ${error.message}`);
            if (peer.initialRetryTimer) {
              clearTimeout(peer.initialRetryTimer);
            }
            peers.delete(key);
            udpPeers.delete(upstream);
            upstream.close();
          });
          logger.info?.(
            `UDP peer ${key} forwarding to ${targetHost}:${mapping.targetPort}.`,
          );
        }
        peer.lastSeen = Date.now();
        peer.remote = remote;
        peer.clientDatagrams += 1;
        peer.upstream.send(message, mapping.targetPort, targetHost, (error) => {
          if (error) {
            logger.error(`UDP upstream send error for ${key}: ${error.message}`);
          }
        });
        if (
          peer.clientDatagrams === 1 &&
          udpInitialRetryMs > 0 &&
          peer.initialRetryTimer === null
        ) {
          const initialDatagram = Buffer.from(message);
          peer.initialRetryTimer = setTimeout(() => {
            peer.initialRetryTimer = null;
            if (
              peers.get(key) !== peer ||
              peer.upstreamDatagrams > 0 ||
              peer.clientDatagrams !== 1
            ) {
              return;
            }
            logger.info?.(
              `Retrying initial UDP datagram for ${key} after ${udpInitialRetryMs}ms without an upstream reply.`,
            );
            peer.upstream.send(initialDatagram, mapping.targetPort, targetHost, (error) => {
              if (error) {
                logger.error(`UDP upstream retry error for ${key}: ${error.message}`);
              }
            });
          }, udpInitialRetryMs);
          peer.initialRetryTimer.unref();
        }
      });
      listener.on("error", (error) => logger.error(`UDP forwarder error: ${error.message}`));

      const cleanup = setInterval(() => {
        const cutoff = Date.now() - idleTimeoutMs;
        for (const [key, peer] of peers) {
          if (peer.lastSeen < cutoff) {
            logger.info?.(
              `UDP peer ${key} expired after ${peer.clientDatagrams} client and ${peer.upstreamDatagrams} upstream datagrams.`,
            );
            peers.delete(key);
            udpPeers.delete(peer.upstream);
            if (peer.initialRetryTimer) {
              clearTimeout(peer.initialRetryTimer);
            }
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
    idle_timeout_ms: idleTimeoutMs,
    udp_initial_retry_ms: udpInitialRetryMs,
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
      udpListeners.forEach(({ peers }) => {
        peers.forEach((peer) => {
          if (peer.initialRetryTimer) {
            clearTimeout(peer.initialRetryTimer);
          }
        });
      });
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
