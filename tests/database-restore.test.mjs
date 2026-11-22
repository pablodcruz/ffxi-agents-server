import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

const syntheticSql = Buffer.from(
  "INSERT INTO accounts (id, login) VALUES (1, 'fixture');\n"
  + "INSERT INTO chars (charid, charname) VALUES (10, 'FixtureCharacter');\n",
);

function restoreFixture(t) {
  const project = mkdtempSync(join(tmpdir(), "ffxi restore test-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  for (const dir of ["scripts", "bin", "tmp"]) mkdirSync(join(project, dir));
  copyFileSync(new URL("../scripts/server.sh", import.meta.url), join(project, "scripts/server.sh"));
  writeFileSync(join(project, ".env"), "# Synthetic configuration; no credentials\n");
  // Simulates only Compose discovery and the restore client's stdin boundary.
  // It does not call Docker or interpret the SQL.
  writeFileSync(join(project, "bin/docker"), `#!/bin/bash
set -euo pipefail
if [[ "$#" == 2 && "$1" == compose && "$2" == version ]]; then exit 0; fi
[[ "$#" == 11 && "$1" == compose && "$2" == --project-directory && "$3" == "$FIXTURE" \
  && "$4" == --env-file && "$5" == "$FIXTURE/.env" \
  && "$6" == exec && "$7" == -T && "$8" == database && "$9" == sh && "\${10}" == -c \
  && "\${11}" == 'exec mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' ]] || {
  printf 'Unexpected fake Docker invocation\n' >&2
  printf "%q\\n" "$@" >&2
  exit 97
}
cat > "$FIXTURE/imported"
exit "$DB_EXIT"
`, { mode: 0o700 });

  return {
    restore(name, bytes, { confirm = true, dbExit = 0 } = {}) {
      const input = join(project, name);
      writeFileSync(input, bytes);
      const run = spawnSync("/bin/bash", [
        join(project, "scripts/server.sh"), "restore", input, ...(confirm ? ["--yes"] : []),
      ], {
        cwd: project,
        env: {
          PATH: `${join(project, "bin")}:/usr/bin:/bin`,
          TMPDIR: join(project, "tmp"),
          FIXTURE: project,
          DB_EXIT: String(dbExit),
        },
        encoding: "utf8",
        timeout: 5000,
      });
      if (run.error) throw run.error;
      const captured = join(project, "imported");
      return {
        ...run,
        captured: existsSync(captured) ? readFileSync(captured) : null,
        temporaryFiles: readdirSync(join(project, "tmp")),
      };
    },
  };
}

test("restore passes a plain dump unchanged to the database client", (t) => {
  const run = restoreFixture(t).restore("plain.sql", syntheticSql);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.captured, syntheticSql);
  assert.match(run.stdout, /^Restored /);
});

test("restore passes a scheduled compressed dump as decompressed SQL", (t) => {
  const run = restoreFixture(t).restore("scheduled.sql.gz", gzipSync(syntheticSql));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.captured?.equals(syntheticSql), true, "database client did not receive SQL bytes");
  assert.match(run.stdout, /^Restored /);
  assert.deepEqual(run.temporaryFiles, []);
});

test("restore rejects a bad gzip checksum before calling the database client", (t) => {
  const corrupt = gzipSync(syntheticSql);
  corrupt[corrupt.length - 8] ^= 0xff; // Complete SQL payload but invalid trailer checksum.
  const run = restoreFixture(t).restore("damaged.sql.gz", corrupt);
  assert.notEqual(run.status, 0);
  assert.equal(run.captured, null);
  assert.doesNotMatch(run.stdout, /Restored /);
  assert.deepEqual(run.temporaryFiles, []);
});

test("restore still refuses a scheduled backup without explicit confirmation", (t) => {
  const run = restoreFixture(t).restore("scheduled.sql.gz", gzipSync(syntheticSql), {
    confirm: false,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /Restore overwrites database objects/);
  assert.equal(run.captured, null);
  assert.deepEqual(run.temporaryFiles, []);
});

test("restore does not report success if the database client fails", (t) => {
  const run = restoreFixture(t).restore("scheduled.sql.gz", gzipSync(syntheticSql), { dbExit: 42 });
  assert.equal(run.status, 42, run.stderr);
  assert.doesNotMatch(run.stdout, /Restored /);
  assert.deepEqual(run.temporaryFiles, []);
});
