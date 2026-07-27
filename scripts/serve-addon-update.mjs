#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  projectDir,
  "ashita",
  "addons",
  "agentbridge",
  "agentbridge.lua",
);
const listenHost = process.env.FFXI_ADDON_UPDATE_HOST || "10.211.55.2";
const expectedPeer = process.env.FFXI_ADDON_UPDATE_PEER || "10.211.55.3";
const listenPort = Number.parseInt(process.env.FFXI_ADDON_UPDATE_PORT || "19769", 10);
const idleTimeoutMs = 2 * 60 * 1000;

if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) {
  throw new Error("FFXI_ADDON_UPDATE_PORT must be an integer from 1024 through 65535.");
}

if (!fs.statSync(sourcePath).isFile()) {
  throw new Error(`Addon source is not a regular file: ${sourcePath}`);
}

function normalizeAddress(address) {
  return address?.replace(/^::ffff:/, "");
}

let idleTimer;
const server = http.createServer((request, response) => {
  if (normalizeAddress(request.socket.remoteAddress) !== expectedPeer) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden.\n");
    return;
  }

  const pathname = new URL(request.url || "/", "http://addon-update.invalid").pathname;
  if (request.method !== "GET" || pathname !== "/agentbridge.lua") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.\n");
    return;
  }

  clearTimeout(idleTimer);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(sourcePath).pipe(response);
  response.on("finish", () => server.close());
});

server.on("error", (error) => {
  console.error(`Addon update server failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  idleTimer = setTimeout(() => {
    console.error("Addon update server expired before the VM retrieved the file.");
    server.close(() => {
      process.exitCode = 1;
    });
  }, idleTimeoutMs);
  idleTimer.unref();
  console.log(
    JSON.stringify({
      status: "ready",
      listen_host: listenHost,
      listen_port: listenPort,
      expected_peer: expectedPeer,
      path: "/agentbridge.lua",
      idle_timeout_ms: idleTimeoutMs,
    }),
  );
});
