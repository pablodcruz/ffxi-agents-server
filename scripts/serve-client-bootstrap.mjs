#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listenHost = process.env.FFXI_BOOTSTRAP_HOST || "10.211.55.2";
const expectedPeer = process.env.FFXI_BOOTSTRAP_PEER || "10.211.55.3";
const listenPort = Number.parseInt(process.env.FFXI_BOOTSTRAP_PORT || "19768", 10);
const idleTimeoutMs = 5 * 60 * 1000;

if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) {
  throw new Error("FFXI_BOOTSTRAP_PORT must be an integer from 1024 through 65535.");
}

const files = new Map([
  ["/agentlab.ini", path.join(projectDir, "ashita", "config", "boot", "agentlab.ini")],
  ["/agentlab.txt", path.join(projectDir, "ashita", "scripts", "agentlab.txt")],
  [
    "/agentbridge.lua",
    path.join(projectDir, "ashita", "addons", "agentbridge", "agentbridge.lua"),
  ],
  ["/config.json", path.join(projectDir, "runtime", "agentbridge-config.json")],
]);

for (const sourcePath of files.values()) {
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile()) {
    throw new Error(`Bootstrap source is not a regular file: ${sourcePath}`);
  }
}

const served = new Set();
let idleTimer;

function normalizeAddress(address) {
  return address?.replace(/^::ffff:/, "");
}

function resetIdleTimer(server) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.error("Client bootstrap server expired before all files were retrieved.");
    server.close(() => process.exitCode = 1);
  }, idleTimeoutMs);
  idleTimer.unref();
}

const server = http.createServer((request, response) => {
  resetIdleTimer(server);

  if (normalizeAddress(request.socket.remoteAddress) !== expectedPeer) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden.\n");
    return;
  }

  const pathname = new URL(request.url || "/", "http://bootstrap.invalid").pathname;
  const sourcePath = files.get(pathname);
  if (request.method !== "GET" || !sourcePath || served.has(pathname)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.\n");
    return;
  }

  served.add(pathname);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": pathname.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });

  const stream = fs.createReadStream(sourcePath);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
  response.on("finish", () => {
    if (served.size === files.size) {
      clearTimeout(idleTimer);
      server.close();
    }
  });
});

server.on("error", (error) => {
  console.error(`Client bootstrap server failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  resetIdleTimer(server);
  console.log(JSON.stringify({
    status: "ready",
    listen_host: listenHost,
    listen_port: listenPort,
    expected_peer: expectedPeer,
    file_count: files.size,
    idle_timeout_ms: idleTimeoutMs,
  }));
});
