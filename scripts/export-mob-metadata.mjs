#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  parseMobMetadataTsv,
  zoneMobIdRange,
} from "../src/mob-scout.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const zoneId = Number(argument("--zone-id"));
const container = argument(
  "--database-container",
  "ffxi-agent-lab-database-1",
);

if (!Number.isInteger(zoneId) || zoneId < 0 || zoneId > 999) {
  throw new Error("--zone-id must be an integer from 0 through 999.");
}
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) {
  throw new Error("--database-container is not a valid container name.");
}
const mobIdRange = zoneMobIdRange(zoneId);

const sql = `
SELECT
  s.mobid,
  s.spawnslotid,
  REPLACE(s.mobname, '_', ' '),
  s.minLevel,
  s.maxLevel,
  s.pos_x,
  s.pos_y,
  s.pos_z,
  g.dropid,
  p.aggro,
  p.links,
  p.true_detection,
  p.behavior,
  p.mobType,
  COALESCE(d.dropType, 0),
  COALESCE(d.groupId, 0),
  COALESCE(d.groupRate, 0),
  COALESCE(d.itemId, 0),
  COALESCE(d.itemRate, 0),
  COALESCE(i.name, ''),
  COALESCE(i.BaseSell, 0)
FROM mob_spawn_points AS s
JOIN mob_groups AS g
  ON g.groupid = s.groupid AND g.zoneid = ${zoneId}
JOIN mob_pools AS p
  ON p.poolid = g.poolid
LEFT JOIN mob_droplist AS d
  ON d.dropId = g.dropid
LEFT JOIN item_basic AS i
  ON i.itemid = d.itemId
WHERE s.mobid >= ${mobIdRange.start}
  AND s.mobid < ${mobIdRange.end}
ORDER BY s.mobid, d.groupId, d.itemId;
`.trim();

const shellCommand = [
  'export MYSQL_PWD="$MARIADB_PASSWORD";',
  'exec mariadb --user="$MARIADB_USER" --database="$MARIADB_DATABASE"',
  '--batch --raw --skip-column-names --execute="$1"',
].join(" ");
const result = spawnSync(
  "docker",
  ["exec", container, "sh", "-lc", shellCommand, "mob-metadata-export", sql],
  {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Mob metadata export failed: ${(result.stderr || "").trim() || `exit ${result.status}`}`,
  );
}

const mobs = parseMobMetadataTsv(result.stdout, zoneId);
const outputDir = path.join(projectDir, "runtime", "mob-metadata");
const outputPath = path.join(outputDir, `zone-${zoneId}.json`);
await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({
    schema_version: 2,
    generated_at: new Date().toISOString(),
    zone_id: zoneId,
    source: "local_landsandboat_database",
    mobs,
  }, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(JSON.stringify({
  zone_id: zoneId,
  mob_count: mobs.length,
  output: path.relative(projectDir, outputPath),
}, null, 2));
