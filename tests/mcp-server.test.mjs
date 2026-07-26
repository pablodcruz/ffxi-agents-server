import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createMockBridge(token) {
  let controlEnabled = false;
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;

      const request = JSON.parse(buffer.slice(0, newline));
      const authenticated = request.token === token;
      const writeOperation = [
        "target_entity",
        "move_to_entity",
        "gameplay_command",
      ].includes(request.operation);
      let ok = authenticated;
      let error;
      let result;

      if (!authenticated) {
        error = "Authentication failed.";
      } else if (request.operation === "enable_control") {
        controlEnabled =
          request.params.confirmation === "ENABLE PRIVATE SERVER CONTROL";
        ok = controlEnabled;
        error = ok ? undefined : "Enabling control requires the exact confirmation phrase.";
        result = { enabled: controlEnabled, operation: request.operation };
      } else if (request.operation === "emergency_stop") {
        controlEnabled = false;
        result = { enabled: false, auto_running: false, movement: null };
      } else if (request.operation === "control_status") {
        result = { enabled: controlEnabled, auto_running: false, movement: null };
      } else if (writeOperation && !controlEnabled) {
        ok = false;
        error = "Agent writes are disabled.";
      } else {
        result = {
          operation: request.operation,
          login_status: 2,
          nearby_entities: [],
          started: request.operation === "move_to_entity" ? true : undefined,
        };
      }
      socket.end(
        `${JSON.stringify({
          id: request.id,
          ok,
          result,
          error,
        })}\n`,
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function createMockLsbApi() {
  const responses = new Map([
    ["/api/sessions", 0],
    ["/api/ips", 0],
    ["/api/zones", [0, 0, 0]],
  ]);
  const server = http.createServer((request, response) => {
    const body = responses.get(request.url);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("MCP server lists tools and reaches the bridge and LSB API", async (context) => {
  const token = "test-token-at-least-24-characters";
  const mockBridge = await createMockBridge(token);
  context.after(() => mockBridge.close());
  const mockLsbApi = await createMockLsbApi();
  context.after(() => mockLsbApi.close());
  const bridgeAddress = mockBridge.address();
  const apiAddress = mockLsbApi.address();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectDir, "src", "mcp-server.mjs")],
    cwd: projectDir,
    env: {
      ...process.env,
      FFXI_BRIDGE_HOST: "127.0.0.1",
      FFXI_BRIDGE_PORT: String(bridgeAddress.port),
      FFXI_BRIDGE_TOKEN: token,
      FFXI_AGENTS_CONFIG: path.join(projectDir, "runtime", "test-agents-do-not-create.json"),
      LSB_API_URL: `http://127.0.0.1:${apiAddress.port}/api`,
    },
  });
  const client = new Client({ name: "ffxi-agent-lab-test", version: "0.1.0" });
  context.after(async () => {
    await client.close();
  });

  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  assert.deepEqual(
    toolNames.sort(),
    [
      "ffxi_gameplay_command",
      "ffxi_agent_profiles",
      "ffxi_character_state",
      "ffxi_control_status",
      "ffxi_emergency_stop",
      "ffxi_enable_control",
      "ffxi_move_to_entity",
      "ffxi_observe",
      "ffxi_recent_events",
      "ffxi_server_status",
      "ffxi_stop_movement",
      "ffxi_target_entity",
    ].sort(),
  );

  const response = await client.callTool({
    name: "ffxi_observe",
    arguments: { radius: 10, max_entities: 8, event_limit: 2 },
  });
  assert.equal(response.isError, undefined);
  assert.equal(response.structuredContent.operation, "observe");
  assert.equal(response.structuredContent.login_status, 2);
  assert.equal(response.structuredContent.agent_id, "primary");

  const characterState = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      inventory_container: 0,
      max_items: 10,
      include_recasts: true,
      max_recasts: 8,
    },
  });
  assert.equal(characterState.isError, undefined);
  assert.equal(characterState.structuredContent.operation, "character_state");
  assert.equal(characterState.structuredContent.login_status, 2);
  assert.equal(characterState.structuredContent.agent_id, "primary");

  const profiles = await client.callTool({
    name: "ffxi_agent_profiles",
    arguments: {},
  });
  assert.equal(profiles.isError, undefined);
  assert.equal(profiles.structuredContent.default_agent, "primary");
  assert.deepEqual(profiles.structuredContent.agents, [
    {
      id: "primary",
      host: "127.0.0.1",
      port: bridgeAddress.port,
    },
  ]);
  assert.equal(JSON.stringify(profiles.structuredContent).includes(token), false);

  const disarmedWrite = await client.callTool({
    name: "ffxi_gameplay_command",
    arguments: { command: "/check <t>" },
  });
  assert.equal(disarmedWrite.isError, true);

  const enabled = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  assert.equal(enabled.isError, undefined);
  assert.equal(enabled.structuredContent.enabled, true);

  const movement = await client.callTool({
    name: "ffxi_move_to_entity",
    arguments: {
      server_id: 1234,
      max_start_distance: 20,
      stop_distance: 3,
      timeout_seconds: 5,
      stuck_seconds: 2,
    },
  });
  assert.equal(movement.isError, undefined);
  assert.equal(movement.structuredContent.operation, "move_to_entity");
  assert.equal(movement.structuredContent.started, true);

  const stopped = await client.callTool({
    name: "ffxi_emergency_stop",
    arguments: {},
  });
  assert.equal(stopped.isError, undefined);
  assert.equal(stopped.structuredContent.enabled, false);
  assert.equal(stopped.structuredContent.auto_running, false);

  const disarmedAfterStop = await client.callTool({
    name: "ffxi_target_entity",
    arguments: { server_id: 1234, max_distance: 20 },
  });
  assert.equal(disarmedAfterStop.isError, true);

  const unknownAgent = await client.callTool({
    name: "ffxi_control_status",
    arguments: { agent_id: "missing" },
  });
  assert.equal(unknownAgent.isError, true);

  const status = await client.callTool({
    name: "ffxi_server_status",
    arguments: {},
  });
  assert.equal(status.isError, undefined);
  assert.equal(status.structuredContent.sessions, 0);
  assert.equal(status.structuredContent.unique_ips, 0);
  assert.deepEqual(status.structuredContent.zones, [0, 0, 0]);
});
