#!/usr/bin/env bash
set -euo pipefail
umask 077

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ffxi-backup-smoke.XXXXXXXX")"
project="ffxi-restore-ci-${tmp##*.}"
project="${project,,}"
export COMPOSE_PROJECT_NAME="$project"
# Use the hosted Linux runner’s local Docker socket only.
unset COMPOSE_FILE COMPOSE_PROFILES DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY
export DOCKER_HOST=unix:///var/run/docker.sock

cd "$tmp"
mkdir scripts
cp "$repo/scripts/server.sh" scripts/
printf '# No production environment.\n' > .env
cat > compose.yaml <<'YAML'
services:
  database:
    image: docker.io/library/mariadb@sha256:628f228f0fd5913a220438693576b29b6fe4dc1fa0a1298c0e98579fae28635f
    network_mode: none
    environment:
      MARIADB_ROOT_PASSWORD: restore-ci-synthetic-only
      MARIADB_DATABASE: restore_ci
    tmpfs:
      - /var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 2s
      timeout: 3s
      retries: 30
YAML

cleanup() {
  status=$?
  trap - EXIT
  if ! docker compose down --volumes --timeout 5; then
    printf 'Disposable Compose cleanup failed.\n' >&2
    status=1
  fi
  cd /
  rm -rf -- "$tmp"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose up --detach --wait --wait-timeout 90 database

query() {
  docker compose exec -T database sh -c \
    'exec mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" --batch --skip-column-names "$MARIADB_DATABASE" --execute="$1"' \
    query "$1"
}

query 'CREATE TABLE restore_probe (id INT PRIMARY KEY, marker VARCHAR(40) NOT NULL);'
[[ "$(query 'SELECT COUNT(*) FROM restore_probe;')" == 0 ]]

printf '%s\n' "INSERT INTO restore_probe VALUES (1, 'pabstack-valid');" | gzip -n > valid.sql.gz
bash scripts/server.sh restore "$tmp/valid.sql.gz" --yes
expected=$'1\tpabstack-valid'
[[ "$(query 'SELECT id, marker FROM restore_probe ORDER BY id;')" == "$expected" ]]

# Byte-level CRC corruption leaves a complete mutating SQL payload before the
# footer error. Import it and the existing row changes; reject it and it stays.
printf '%s\n' "UPDATE restore_probe SET marker='unexpected' WHERE id=1;" \
  "INSERT INTO restore_probe VALUES (2, 'unexpected');" | gzip -n > corrupt.sql.gz
python3 - <<'PYTHON'
from pathlib import Path
path = Path("corrupt.sql.gz")
raw = bytearray(path.read_bytes())
raw[-8] ^= 0xff
path.write_bytes(raw)
PYTHON
if bash scripts/server.sh restore "$tmp/corrupt.sql.gz" --yes > rejected.log 2>&1; then
  printf 'Corrupt backup unexpectedly reported success.\n' >&2
  exit 1
fi
grep -F 'Could not decompress backup' rejected.log
[[ "$(query 'SELECT id, marker FROM restore_probe ORDER BY id;')" == "$expected" ]]
printf 'Valid gzip populated the fixture; corrupt gzip left it unchanged.\n'
