#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_DIR="${PROJECT_DIR}/runtime/backups"
LOCK_DIR="${PROJECT_DIR}/runtime/locks/backup"

read_env_value() {
  local requested_key="$1"
  local default_value="$2"
  local line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == "${requested_key}="* ]]; then
      printf '%s\n' "${line#*=}"
      return 0
    fi
  done < "${ENV_FILE}"
  printf '%s\n' "${default_value}"
}

sha256_file() {
  openssl dgst -sha256 -r "$1" | awk '{print $1}'
}

mkdir -p "${BACKUP_DIR}" "$(dirname "${LOCK_DIR}")"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  printf '%s\n' "Another scheduled backup is already running." >&2
  exit 1
fi
cleanup() {
  rmdir "${LOCK_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

backup_output="$("${PROJECT_DIR}/scripts/server.sh" backup)"
printf '%s\n' "${backup_output}"
backup_path="${backup_output#Created }"
[[ -f "${backup_path}" ]] || {
  printf '%s\n' "Could not identify the new backup path." >&2
  exit 1
}

gzip -9 "${backup_path}"
compressed_path="${backup_path}.gz"
"${PROJECT_DIR}/scripts/verify-backup.sh" "${compressed_path}"

retention_count="$(read_env_value FFXI_BACKUP_RETENTION_COUNT 30)"
prune_enabled="$(read_env_value FFXI_BACKUP_PRUNE false)"
[[ "${retention_count}" =~ ^[1-9][0-9]*$ ]] || {
  printf '%s\n' "FFXI_BACKUP_RETENTION_COUNT must be a positive integer." >&2
  exit 1
}

backups=()
while IFS= read -r path; do
  backups+=("${path}")
done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'xidb-*.sql.gz' -print | sort)

excess=$(( ${#backups[@]} - retention_count ))
if (( excess > 0 )) && [[ "${prune_enabled}" == "true" ]]; then
  for (( index = 0; index < excess; index++ )); do
    old_backup="${backups[index]}"
    marker="${old_backup}.verified"
    [[ -f "${marker}" ]] || {
      printf 'Refusing to prune unverified backup: %s\n' "${old_backup}" >&2
      exit 1
    }
    expected_hash="$(sed -n 's/^sha256=//p' "${marker}")"
    actual_hash="$(sha256_file "${old_backup}")"
    [[ -n "${expected_hash}" && "${expected_hash}" == "${actual_hash}" ]] || {
      printf 'Refusing to prune changed backup: %s\n' "${old_backup}" >&2
      exit 1
    }
    rm -- "${old_backup}" "${marker}"
    printf 'Pruned verified backup: %s\n' "${old_backup}"
  done
elif (( excess > 0 )); then
  printf '%s\n' \
    "${excess} verified backup(s) exceed retention, but pruning is disabled." \
    "Set FFXI_BACKUP_PRUNE=true only after copying backups off-host."
fi
