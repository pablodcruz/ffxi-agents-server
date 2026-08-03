#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const mogHouseRelief = process.argv.includes("--moghouse-relief");
const containers = [0, 6, 7, 8, 9];
const sellPolicy = new Map([
  [505,"Sheepskin"],[573,"Vegetable Seeds"],[575,"Grain Seeds"],
  [750,"Silver Beastcoin"],[768,"Flint Stone"],[846,"Insect Wing"],[847,"Bird Feather"],
  [852,"Lizard Skin"],[856,"Rabbit Hide"],[881,"Crab Shell"],[882,"Sheep Tooth"],
  [912,"Beehive Chip"],[922,"Bat Wing"],[924,"Fiend Blood"],[925,"Giant Stinger"],
  [926,"Lizard Tail"],[936,"Rock Salt"],[953,"Treant Bulb"],[1984,"Snapping Mole"],
  [4358,"Hare Meat"],[4362,"Lizard Egg"],[4366,"La Theine Cabbage"],
  [4368,"Two-Leaf Mandragora Bud"],[4370,"Honey"],[4372,"Giant Sheep Meat"],
  [4387,"Wild Onion"],[4400,"Land Crab Meat"],[4468,"Pamamas"],[4570,"Bird Egg"],
  [5187,"Elshimo Coconut"],[17296,"Pebble"],[17868,"Humus"],
  [12464,"Headgear"],[12592,"Doublet"],[12720,"Gloves"],[12848,"Brais"],
  [12864,"Slacks"],[12976,"Gaiters"],[17051,"Yew Wand"],
]);
const crystals = new Set([4096, 4098, 4099, 4101]);
// Retained collectibles, keys, quest items, and crafting materials that do not
// need to consume field-inventory slots. Keep combat consumables and utility
// items (Warp/Echad/Raising) immediately available instead.
const archive = new Set([
  501,   // Quadav Helm
  537,
  816,   // Silk Thread
  889,   // Beetle Shell
  1025,
  1032,  // Shakhrami Chest Key
  1040,  // Nest Chest Key
  1146,  // Elshimo Marble
  1156,  // Crawler Calculus
  1534,  // Mithra Fang Sack
  1708,
  1789,  // Chocopass
  2758,
  2759,
  3297,  // Flame Geode
  3298,  // Snow Geode
  3302,  // Aqua Geode
  3304,  // Shadow Geode
  4377,  // Coeurl Meat
  6181,
  10158,
  16486, // Beestinger
  17397, // Shell Bug
]);
const wardrobe = new Set([12816, 12944, 13116]);
const currency = new Set([1126, 8711]);
const unsoldArchive = new Set([508, 511, 12631, 12754, 12883, 13005]);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp-server.mjs")],
  cwd: projectDir,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({name:"ffxi-agent-lab-inventory-cleanup",version:"0.1.0"});
const valueOf = (response) => response.structuredContent || response.content;
const pause = (ms=350) => new Promise((resolve) => setTimeout(resolve, ms));

async function state(container) {
  const response = await client.callTool({name:"ffxi_character_state",arguments:{
    inventory_container:container,max_items:80,include_recasts:false,
  }});
  if (response.isError) throw new Error(`Could not read container ${container}.`);
  return valueOf(response);
}
function items(snapshot) {
  return (snapshot.inventory?.items || []).filter((item) => Number(item.item_id) !== 65535);
}
function total(snapshot, itemId) {
  return items(snapshot).filter((item) => Number(item.item_id) === itemId)
    .reduce((sum,item) => sum + Number(item.count || 0), 0);
}
async function move(source, slot, destination, itemId, quantity) {
  const [beforeSource,beforeDestination] = await Promise.all([state(source),state(destination)]);
  const response = await client.callTool({name:"ffxi_move_inventory_item",arguments:{
    source_container:source,source_slot:slot,destination_container:destination,
    item_id:itemId,quantity,confirmation:"MOVE PRIVATE SERVER INVENTORY ITEM",
  }});
  if (response.isError) throw new Error(`Move rejected for item ${itemId}.`);
  for (let attempt=0; attempt<12; attempt+=1) {
    await pause();
    const [afterSource,afterDestination] = await Promise.all([state(source),state(destination)]);
    if (total(afterSource,itemId) === total(beforeSource,itemId)-quantity &&
        total(afterDestination,itemId) === total(beforeDestination,itemId)+quantity) return;
  }
  throw new Error(`Move verification timed out for item ${itemId}.`);
}
async function sell(slot,itemId,quantity) {
  const before = await state(0);
  const beforeGil = before.inventory.items.find((item)=>item.item_id===65535)?.count || 0;
  const response = await client.callTool({name:"ffxi_sell_inventory_item",arguments:{
    source_slot:slot,item_id:itemId,quantity,
    confirmation:"SELL PRIVATE SERVER INVENTORY ITEM",
  }});
  if (response.isError) throw new Error(`Sale rejected for item ${itemId}.`);
  for (let attempt=0; attempt<16; attempt+=1) {
    await pause(250);
    const after = await state(0);
    const afterGil = after.inventory.items.find((item)=>item.item_id===65535)?.count || 0;
    if (total(after,itemId) === total(before,itemId)-quantity && afterGil>beforeGil) {
      return afterGil-beforeGil;
    }
  }
  throw new Error(`Sale verification timed out for item ${itemId}.`);
}
async function moveAll(itemSet,destination,sourceList=containers) {
  const moved=[];
  const skipped=[];
  for (const source of sourceList) {
    if (source===destination) continue;
    const snapshot=await state(source);
    for (const planned of items(snapshot).filter((item)=>itemSet.has(Number(item.item_id)))) {
      const live=items(await state(source)).find((item)=>
        Number(item.item_id)===Number(planned.item_id) && Number(item.count)>=Number(planned.count));
      if (!live) continue;
      try {
        await move(source,live.slot,destination,Number(live.item_id),Number(live.count));
        moved.push({name:live.name,quantity:live.count,source,destination});
      } catch (error) {
        skipped.push({name:live.name,source,destination,reason:error.message});
      }
    }
  }
  return {moved,skipped};
}

async function applyMovePolicy(itemSet,destination,sourceList) {
  const result=await moveAll(itemSet,destination,sourceList);
  report.moved.push(...result.moved);
  report.skipped.push(...result.skipped);
}

const report={sold:[],moved:[],skipped:[]};
try {
  await client.connect(transport);
  const initial=await state(0);
  if (initial.menu_open) throw new Error("Close the in-game menu before cleanup.");
  const enable=await client.callTool({name:"ffxi_enable_control",arguments:{confirmation:"ENABLE PRIVATE SERVER CONTROL"}});
  if (enable.isError) throw new Error("Could not arm private-server control.");

  for (const source of [0,6,7,8]) {
    const planned=items(await state(source)).filter((item)=>sellPolicy.has(Number(item.item_id)));
    for (const item of planned) {
      try {
        let live=items(await state(source)).find((entry)=>
          Number(entry.item_id)===Number(item.item_id) && Number(entry.count)>=Number(item.count));
        if (!live) continue;
        if (source!==0) {
          await move(source,live.slot,0,Number(live.item_id),Number(live.count));
          live=items(await state(0)).find((entry)=>Number(entry.item_id)===Number(item.item_id));
        }
        const gil=await sell(live.slot,Number(live.item_id),Number(item.count));
        report.sold.push({name:item.name,quantity:item.count,gil});
      } catch (error) {
        report.skipped.push({name:item.name,source,reason:error.message});
      }
    }
  }

  // Safe 2 is writable only while the live character is inside the Mog House.
  // The explicit relief mode empties accumulated crystal stacks from the
  // field-accessible Case into Safe 2; ordinary field cleanup still targets
  // the Case and safely rejects locked destinations.
  await applyMovePolicy(crystals,mogHouseRelief ? 9 : 7,
    mogHouseRelief ? [0,6,7] : [0,6]);
  // Mog Safe 2 is not writable outside the Mog House. The always-available
  // Mog Case is the low-friction archive while adventuring.
  await applyMovePolicy(archive,7,[0,6,8]);
  await applyMovePolicy(unsoldArchive,7,[0,6,8]);
  await applyMovePolicy(wardrobe,8,[0,6,7,9]);
  // Consolidate seals and vouchers directly in the Mog Sack. Routing them
  // through the Case first needlessly moved every existing stack twice.
  await applyMovePolicy(currency,6,[0,7,8]);

  const finalStates=await Promise.all(containers.map(state));
  report.containers=Object.fromEntries(finalStates.map((snapshot,index)=>[
    containers[index],{count:snapshot.inventory?.count,capacity:snapshot.inventory?.capacity},
  ]));
  report.gil=finalStates[0].inventory?.items.find((item)=>item.item_id===65535)?.count || 0;
  report.verified=true;
  console.log(JSON.stringify(report,null,2));
} finally {
  await client.callTool({name:"ffxi_emergency_stop",arguments:{}}).catch(()=>{});
  await client.close().catch(()=>{});
}
