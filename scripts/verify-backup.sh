#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_PATH="${1:-}"

[[ -n "${BACKUP_PATH}" ]] || {
  printf '%s\n' "Usage: ./scripts/verify-backup.sh /path/to/xidb.sql[.gz]" >&2
  exit 1
}
[[ -f "${BACKUP_PATH}" ]] || {
  printf 'Backup does not exist: %s\n' "${BACKUP_PATH}" >&2
  exit 1
}
[[ -f "${ENV_FILE}" ]] || {
  printf '%s\n' "Run ./scripts/server.sh init first." >&2
  exit 1
}

read_env_value() {
  local requested_key="$1"
  local line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == "${requested_key}="* ]]; then
      printf '%s\n' "${line#*=}"
      return 0
    fi
  done < "${ENV_FILE}"
  return 1
}

sha256_file() {
  openssl dgst -sha256 -r "$1" | awk '{print $1}'
}

database_image="$(read_env_value LSB_DATABASE_IMAGE)"
container_name="ffxi-agent-backup-check-$(openssl rand -hex 5)"
temporary_password="$(openssl rand -hex 24)"

cleanup() {
  docker stop "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run \
  --rm \
  --detach \
  --name "${container_name}" \
  --network none \
  -e "MARIADB_ROOT_PASSWORD=${temporary_password}" \
  -e MARIADB_DATABASE=xidb \
  "${database_image}" >/dev/null

ready=0
for _ in {1..30}; do
  if docker exec "${container_name}" \
    mariadb --user=root --password="${temporary_password}" \
      --execute="SELECT 1" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if (( ready == 0 )); then
  printf '%s\n' "Disposable verification database did not become ready." >&2
  exit 1
fi

case "${BACKUP_PATH}" in
  *.sql.gz)
    gzip -dc "${BACKUP_PATH}" |
      docker exec -i "${container_name}" \
        mariadb --user=root --password="${temporary_password}" xidb
    ;;
  *.sql)
    docker exec -i "${container_name}" \
      mariadb --user=root --password="${temporary_password}" xidb \
      < "${BACKUP_PATH}"
    ;;
  *)
    printf '%s\n' "Backup must end in .sql or .sql.gz." >&2
    exit 1
    ;;
esac

docker exec "${container_name}" \
  mariadb-check --silent --user=root --password="${temporary_password}" xidb

counts="$(
  docker exec "${container_name}" \
    mariadb --batch --skip-column-names \
      --user=root --password="${temporary_password}" \
      --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='xidb'; SELECT COUNT(*) FROM xidb.accounts;"
)"
table_count="$(printf '%s\n' "${counts}" | sed -n '1p')"
account_count="$(printf '%s\n' "${counts}" | sed -n '2p')"

if [[ ! "${table_count}" =~ ^[0-9]+$ ]] || (( table_count < 100 )); then
  printf 'Restore produced an implausible table count: %s\n' "${table_count}" >&2
  exit 1
fi
if [[ ! "${account_count}" =~ ^[0-9]+$ ]]; then
  printf 'Restore produced an invalid account count: %s\n' "${account_count}" >&2
  exit 1
fi

marker="${BACKUP_PATH}.verified"
{
  printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'sha256=%s\n' "$(sha256_file "${BACKUP_PATH}")"
  printf 'tables=%s\n' "${table_count}"
  printf 'accounts=%s\n' "${account_count}"
} > "${marker}"
chmod 600 "${marker}"

printf 'Verified %s: tables=%s accounts=%s\n' \
  "${BACKUP_PATH}" "${table_count}" "${account_count}"
