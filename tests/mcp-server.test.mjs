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
        "clear_target",
        "change_job",
        "input_action",
        "set_heading",
        "target_entity",
        "interact",
        "menu_input",
        "move_to_entity",
        "move_to_position",
        "move_inventory_item",
        "sell_inventory_item",
        "buy_vendor_item",
        "service_teleport",
        "private_server_bastok_mission",
        "private_server_vendor_transaction",
        "private_server_nm_reposition",
        "private_server_rdm30_gear",
        "private_server_rdm_spell",
        "private_server_rdm_spell_grant",
        "private_server_reload_agentspell",
        "cancel_new_adventurer_status",
        "start_roe_objective",
        "set_activity_feed",
        "set_goal_overlay",
        "gameplay_command",
        "fishing_bot_start",
        "fishing_bot_stop",
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
      } else if (request.operation === "clear_target") {
        result = { cleared: true, target_index: 0 };
      } else if (request.operation === "set_activity_feed") {
        result = {
          enabled: request.params.enabled,
          local_chat_only: true,
        };
      } else if (request.operation === "set_goal_overlay") {
        result = {
          enabled: request.params.enabled,
          current_gil: request.params.current_gil,
          target_gil: request.params.target_gil,
          title: request.params.title,
          progress_label: request.params.progress_label,
          local_overlay_only: true,
        };
      } else {
        result = {
          operation: request.operation,
          login_status: 2,
          nearby_entities: [],
          started: ["move_to_entity", "move_to_position"].includes(request.operation)
            ? true
            : undefined,
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
      "ffxi_buy_vendor_item",
      "ffxi_cancel_new_adventurer_status",
      "ffxi_character_state",
      "ffxi_change_job",
      "ffxi_clear_target",
      "ffxi_control_status",
      "ffxi_directional_input",
      "ffxi_emergency_stop",
      "ffxi_enable_control",
      "ffxi_face_heading",
      "ffxi_farm_start",
      "ffxi_farm_status",
      "ffxi_farm_stop",
      "ffxi_fishing_bot_start",
      "ffxi_fishing_bot_status",
      "ffxi_fishing_bot_stop",
      "ffxi_interact",
      "ffxi_menu_input",
      "ffxi_move_to_entity",
      "ffxi_move_inventory_item",
      "ffxi_move_to_position",
      "ffxi_observe",
      "ffxi_private_server_bastok_mission",
      "ffxi_private_server_vendor_transaction",
      "ffxi_private_server_nm_reposition",
      "ffxi_private_server_rdm30_gear",
      "ffxi_private_server_rdm_spell",
      "ffxi_private_server_rdm_spell_grant",
      "ffxi_private_server_reload_agentspell",
      "ffxi_recent_events",
      "ffxi_server_status",
      "ffxi_service_teleport",
      "ffxi_set_activity_feed",
      "ffxi_set_goal_overlay",
      "ffxi_sell_inventory_item",
      "ffxi_start_roe_objective",
      "ffxi_stop_movement",
      "ffxi_target_entity",
      "ffxi_trade_maat_genkai_items",
      "ffxi_trade_npc_item_stack",
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

  const disarmedInteract = await client.callTool({
    name: "ffxi_interact",
    arguments: { mode: "target", server_id: 1234, max_distance: 6 },
  });
  assert.equal(disarmedInteract.isError, true);

  const disarmedFeed = await client.callTool({
    name: "ffxi_set_activity_feed",
    arguments: { enabled: true },
  });
  assert.equal(disarmedFeed.isError, true);

  const disarmedGoal = await client.callTool({
    name: "ffxi_set_goal_overlay",
    arguments: { enabled: true, current_gil: 80, target_gil: 10000 },
  });
  assert.equal(disarmedGoal.isError, true);

  const enabled = await client.callTool({
    name: "ffxi_enable_control",
    arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
  });
  assert.equal(enabled.isError, undefined);
  assert.equal(enabled.structuredContent.enabled, true);

  const activityFeed = await client.callTool({
    name: "ffxi_set_activity_feed",
    arguments: { enabled: true },
  });
  assert.equal(activityFeed.isError, undefined);
  assert.equal(activityFeed.structuredContent.enabled, true);
  assert.equal(activityFeed.structuredContent.local_chat_only, true);

  const goalOverlay = await client.callTool({
    name: "ffxi_set_goal_overlay",
    arguments: {
      enabled: true,
      current_gil: 80,
      target_gil: 10000,
      title: "UNLOCK UNITY VIA RECORDS OF EMINENCE",
      progress_label: "VANQUISH: 90 / 200",
    },
  });
  assert.equal(goalOverlay.isError, undefined);
  assert.equal(goalOverlay.structuredContent.enabled, true);
  assert.equal(goalOverlay.structuredContent.current_gil, 80);
  assert.equal(goalOverlay.structuredContent.target_gil, 10000);
  assert.equal(
    goalOverlay.structuredContent.title,
    "UNLOCK UNITY VIA RECORDS OF EMINENCE",
  );
  assert.equal(
    goalOverlay.structuredContent.progress_label,
    "VANQUISH: 90 / 200",
  );
  assert.equal(goalOverlay.structuredContent.local_overlay_only, true);

  const menuInput = await client.callTool({
    name: "ffxi_menu_input",
    arguments: { action: "open_main_menu" },
  });
  assert.equal(menuInput.isError, undefined);
  assert.equal(menuInput.structuredContent.operation, "menu_input");

  const equipmentShortcut = await client.callTool({
    name: "ffxi_menu_input",
    arguments: { action: "open_equipment" },
  });
  assert.equal(equipmentShortcut.isError, undefined);
  assert.equal(equipmentShortcut.structuredContent.operation, "menu_input");

  const roeObjective = await client.callTool({
    name: "ffxi_start_roe_objective",
    arguments: {
      objective_id: 937,
      confirmation: "START PRIVATE SERVER ROE OBJECTIVE",
    },
  });
  assert.equal(roeObjective.isError, undefined);
  assert.equal(roeObjective.structuredContent.operation, "start_roe_objective");

  const jobChange = await client.callTool({
    name: "ffxi_change_job",
    arguments: {
      slot: "main",
      job_id: 3,
      confirmation: "CHANGE PRIVATE SERVER JOB",
    },
  });
  assert.equal(jobChange.isError, undefined);
  assert.equal(jobChange.structuredContent.operation, "change_job");

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

  const waypointMovement = await client.callTool({
    name: "ffxi_move_to_position",
    arguments: {
      x: -220.5,
      y: -100.25,
      max_start_distance: 60,
      stop_distance: 1,
      timeout_seconds: 10,
      stuck_seconds: 3,
    },
  });
  assert.equal(waypointMovement.isError, undefined);
  assert.equal(waypointMovement.structuredContent.operation, "move_to_position");
  assert.equal(waypointMovement.structuredContent.started, true);

  const heading = await client.callTool({
    name: "ffxi_face_heading",
    arguments: { heading: 0 },
  });
  assert.equal(heading.isError, undefined);
  assert.equal(heading.structuredContent.operation, "set_heading");

  const serviceTeleport = await client.callTool({
    name: "ffxi_service_teleport",
    arguments: {
      x: -304,
      y: -161.5,
      z: -10.32,
      zone_id: 235,
      reason: "vendor",
      confirmation: "TELEPORT PRIVATE SERVER CHARACTER",
    },
  });
  assert.equal(serviceTeleport.isError, undefined);
  assert.equal(serviceTeleport.structuredContent.operation, "service_teleport");

  const bastokMission = await client.callTool({
    name: "ffxi_private_server_bastok_mission",
    arguments: {
      action: "begin",
      mission_id: 10,
      quantity: 0,
      confirmation: "ADVANCE PRIVATE SERVER BASTOK MISSION",
    },
  });
  assert.equal(bastokMission.isError, undefined);
  assert.equal(
    bastokMission.structuredContent.operation,
    "private_server_bastok_mission",
  );

  const cancelNewAdventurer = await client.callTool({
    name: "ffxi_cancel_new_adventurer_status",
    arguments: {
      confirmation: "CANCEL PRIVATE SERVER NEW ADVENTURER STATUS",
    },
  });
  assert.equal(cancelNewAdventurer.isError, undefined);
  assert.equal(
    cancelNewAdventurer.structuredContent.operation,
    "cancel_new_adventurer_status",
  );

  const ironSwordPurchase = await client.callTool({
    name: "ffxi_private_server_vendor_transaction",
    arguments: {
      action: "buy",
      item_id: 16536,
      quantity: 1,
      confirmation: "TRANSACT WITH NEARBY PRIVATE SERVER VENDOR",
    },
  });
  assert.equal(ironSwordPurchase.isError, undefined);
  assert.equal(
    ironSwordPurchase.structuredContent.operation,
    "private_server_vendor_transaction",
  );

  const fishingCatchSale = await client.callTool({
    name: "ffxi_private_server_vendor_transaction",
    arguments: {
      action: "sell",
      item_id: 4401,
      quantity: 12,
      confirmation: "TRANSACT WITH NEARBY PRIVATE SERVER VENDOR",
    },
  });
  assert.equal(fishingCatchSale.isError, undefined);
  assert.equal(
    fishingCatchSale.structuredContent.operation,
    "private_server_vendor_transaction",
  );

  const nmReposition = await client.callTool({
    name: "ffxi_private_server_nm_reposition",
    arguments: {
      mob_id: 17588685,
      confirmation: "REPOSITION NEARBY PRIVATE SERVER NM",
    },
  });
  assert.equal(nmReposition.isError, undefined);
  assert.equal(
    nmReposition.structuredContent.operation,
    "private_server_nm_reposition",
  );

  const rdmSpellPurchase = await client.callTool({
    name: "ffxi_private_server_rdm_spell",
    arguments: {
      spell: "enthunder",
      confirmation: "BUY PRIVATE SERVER RDM SPELL",
    },
  });
  assert.equal(rdmSpellPurchase.isError, undefined);
  assert.equal(
    rdmSpellPurchase.structuredContent.operation,
    "private_server_rdm_spell",
  );

  const rdmSpellGrant = await client.callTool({
    name: "ffxi_private_server_rdm_spell_grant",
    arguments: {
      spell: "refresh",
      confirmation: "GRANT PRIVATE SERVER RDM SPELL",
    },
  });
  assert.equal(rdmSpellGrant.isError, undefined);
  assert.equal(
    rdmSpellGrant.structuredContent.operation,
    "private_server_rdm_spell_grant",
  );

  const rdmSpellReload = await client.callTool({
    name: "ffxi_private_server_reload_agentspell",
    arguments: {
      confirmation: "RELOAD PRIVATE SERVER AGENTSPELL",
    },
  });
  assert.equal(rdmSpellReload.isError, undefined);
  assert.equal(
    rdmSpellReload.structuredContent.operation,
    "private_server_reload_agentspell",
  );

  const itemMove = await client.callTool({
    name: "ffxi_move_inventory_item",
    arguments: {
      source_container: 6,
      source_slot: 5,
      destination_container: 9,
      item_id: 8711,
      quantity: 1,
      confirmation: "MOVE PRIVATE SERVER INVENTORY ITEM",
    },
  });
  assert.equal(itemMove.isError, undefined);
  assert.equal(itemMove.structuredContent.operation, "move_inventory_item");

  const inventorySale = await client.callTool({
    name: "ffxi_sell_inventory_item",
    arguments: {
      source_slot: 7,
      item_id: 12385,
      quantity: 1,
      confirmation: "SELL PRIVATE SERVER INVENTORY ITEM",
    },
  });
  assert.equal(inventorySale.isError, undefined);
  assert.equal(inventorySale.structuredContent.operation, "sell_inventory_item");

  const vendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17739806,
      item_id: 4772,
      maximum_price: 4600,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(vendorPurchase.isError, undefined);
  assert.equal(vendorPurchase.structuredContent.operation, "buy_vendor_item");

  const questItemVendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17739811,
      item_id: 13454,
      maximum_price: 100,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(questItemVendorPurchase.isError, undefined);
  assert.equal(
    questItemVendorPurchase.structuredContent.operation,
    "buy_vendor_item",
  );

  const exactNpcTrade = await client.callTool({
    name: "ffxi_trade_npc_item_stack",
    arguments: {
      npc_server_id: 17793039,
      npc_index: 15,
      source_slot: 27,
      item_id: 9082,
      quantity: 3,
      confirmation: "TRADE EXACT PRIVATE SERVER NPC ITEM STACK",
    },
  });
  assert.equal(exactNpcTrade.isError, undefined);
  assert.equal(
    exactNpcTrade.structuredContent.operation,
    "trade_npc_item_stack",
  );

  const weaponVendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17739798,
      item_id: 16535,
      maximum_price: 281,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(weaponVendorPurchase.isError, undefined);
  assert.equal(
    weaponVendorPurchase.structuredContent.operation,
    "buy_vendor_item",
  );

  const spellVendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17793068,
      item_id: 4768,
      maximum_price: 6645,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(spellVendorPurchase.isError, undefined);
  assert.equal(
    spellVendorPurchase.structuredContent.operation,
    "buy_vendor_item",
  );

  const fishingBaitVendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17801278,
      item_id: 16998,
      maximum_price: 42,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(fishingBaitVendorPurchase.isError, undefined);
  assert.equal(
    fishingBaitVendorPurchase.structuredContent.operation,
    "buy_vendor_item",
  );

  const lugwormVendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17735725,
      item_id: 17395,
      maximum_price: 20,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(lugwormVendorPurchase.isError, undefined);
  assert.equal(
    lugwormVendorPurchase.structuredContent.operation,
    "buy_vendor_item",
  );

  const willowRodVendorPurchase = await client.callTool({
    name: "ffxi_buy_vendor_item",
    arguments: {
      npc_server_id: 17735725,
      item_id: 17391,
      maximum_price: 1000,
      quantity: 1,
      confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
    },
  });
  assert.equal(willowRodVendorPurchase.isError, undefined);
  assert.equal(
    willowRodVendorPurchase.structuredContent.operation,
    "buy_vendor_item",
  );

  const interaction = await client.callTool({
    name: "ffxi_interact",
    arguments: {
      mode: "target",
      server_id: 1234,
      max_distance: 6,
    },
  });
  assert.equal(interaction.isError, undefined);
  assert.equal(interaction.structuredContent.operation, "interact");

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
