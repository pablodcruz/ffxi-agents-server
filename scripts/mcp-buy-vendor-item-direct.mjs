#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function integerArgument(name, minimum, maximum) {
  const value = Number.parseInt(argument(name), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

const npcServerId = integerArgument("--npc-server-id", 1, 0xFFFFFFFF);
const itemId = integerArgument("--item-id", 1, 65534);
const maximumPrice = integerArgument("--max-price", 1, 999999999);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({
  name: "ffxi-agent-lab-buy-vendor-item-direct",
  version: "0.1.0",
});

function valueOf(response) {
  return response.structuredContent || response.content;
}

function errorDetail(response) {
  if (!Array.isArray(response?.content)) return "";
  return response.content
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join(" ");
}

async function state() {
  const response = await client.callTool({
    name: "ffxi_character_state",
    arguments: {
      inventory_container: 0,
      max_items: 80,
      include_recasts: false,
    },
  });
  if (response.isError) throw new Error("Could not read character state.");
  return valueOf(response);
}

function countItem(snapshot) {
  return snapshot.inventory?.items
    ?.filter((item) => Number(item.item_id) === itemId)
    .reduce((sum, item) => sum + Number(item.count || 0), 0) || 0;
}

function gil(snapshot) {
  return Number(
    snapshot.inventory?.items
      ?.find((item) => Number(item.item_id) === 65535)
      ?.count || 0,
  );
}

try {
  await client.connect(transport);
  const before = await state();
  if (
    !before.menu_open
    || String(before.menu_name || "").trim() !== "menu    shopmain"
  ) {
    throw new Error(
      "Direct purchase requires an active general-shop merchant context.",
    );
  }
  if ((before.inventory?.capacity - before.inventory?.count) < 1) {
    throw new Error("Direct purchase requires one free main-inventory slot.");
  }
  const beforeCount = countItem(before);
  const beforeGil = gil(before);
  if (beforeGil < maximumPrice) {
    throw new Error(`The ${maximumPrice}-gil purchase cap is unaffordable.`);
  }

  try {
    const enable = await client.callTool({
      name: "ffxi_enable_control",
      arguments: { confirmation: "ENABLE PRIVATE SERVER CONTROL" },
    });
    if (enable.isError) throw new Error("Could not arm private-server control.");

    const purchase = await client.callTool({
      name: "ffxi_buy_vendor_item",
      arguments: {
        npc_server_id: npcServerId,
        item_id: itemId,
        maximum_price: maximumPrice,
        quantity: 1,
        confirmation: "BUY PRIVATE SERVER VENDOR ITEM",
      },
    });
    if (purchase.isError) {
      const detail = errorDetail(purchase);
      throw new Error(
        `The guarded direct vendor purchase was rejected${detail ? `: ${detail}` : "."}`,
      );
    }

    const bridgeResult = valueOf(purchase);
    const unitPrice = Number(bridgeResult.unit_price);
    if (!Number.isInteger(unitPrice) || unitPrice < 1 || unitPrice > maximumPrice) {
      throw new Error("The bridge did not return a valid live price within the cap.");
    }
    let after;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      after = await state();
      if (
        countItem(after) === beforeCount + 1
        && gil(after) === beforeGil - unitPrice
      ) {
        break;
      }
    }
    const afterCount = countItem(after);
    const afterGil = gil(after);
    if (
      afterCount !== beforeCount + 1
      || afterGil !== beforeGil - unitPrice
    ) {
      throw new Error(
        "The exact inventory increase and gil decrease were not observed; no retry was attempted.",
      );
    }

    console.log(JSON.stringify({
      protocol: "mcp-stdio",
      purchased: true,
      item: {
        item_id: itemId,
        quantity: 1,
        unit_price: unitPrice,
        maximum_price: maximumPrice,
      },
      merchant: { server_id: npcServerId },
      inventory_count_before: beforeCount,
      inventory_count_after: afterCount,
      gil_before: beforeGil,
      gil_after: afterGil,
      bridge_result: bridgeResult,
      verified: true,
    }, null, 2));
  } finally {
    await client.callTool({ name: "ffxi_emergency_stop", arguments: {} })
      .catch(() => {});
  }
} finally {
  await client.close().catch(() => {});
}
