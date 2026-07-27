#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
BACKUP_DIR="${PROJECT_DIR}/runtime/backups"

compose_command() {
  if docker compose version >/dev/null 2>&1; then
    printf '%s\n' "docker compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    printf '%s\n' "docker-compose"
    return
  fi
  printf '%s\n' "Docker Compose v2 is required." >&2
  exit 1
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  printf '%s\n' "OpenSSL is required to generate local database credentials." >&2
  exit 1
}

init_environment() {
  if [[ -e "${ENV_FILE}" ]]; then
    printf '%s\n' ".env already exists; leaving it unchanged."
    return
  fi

  umask 077
  local root_password
  local app_password
  root_password="$(random_secret)"
  app_password="$(random_secret)"
  {
    printf 'LSB_DB_ROOT_PASSWORD=%s\n' "${root_password}"
    printf 'LSB_DB_PASSWORD=%s\n' "${app_password}"
    printf 'LSB_BIND_IP=127.0.0.1\n'
    printf 'LSB_ZONE_IP=127.0.0.1\n'
    printf 'FFXI_FORWARD_LISTEN_HOST=\n'
    printf 'LSB_ACCOUNT_CREATION=true\n'
    printf 'LSB_WATCHDOG_PERIOD_MS=30000\n'
    printf 'LSB_SERVER_IMAGE=ghcr.io/landsandboat/server@sha256:d502012d679b516924acaf31a31c2ccf6696b1490792833157a273b6ac7d2d83\n'
    printf 'LSB_MESH_IMAGE=ghcr.io/landsandboat/ximeshes@sha256:39558f676a18362581368cac19a1e54cd013a74e660767c1f3c6362ef1d2321f\n'
    printf 'LSB_DATABASE_IMAGE=mariadb@sha256:628f228f0fd5913a220438693576b29b6fe4dc1fa0a1298c0e98579fae28635f\n'
    printf 'FFXI_BACKUP_RETENTION_COUNT=30\n'
    printf 'FFXI_BACKUP_PRUNE=false\n'
  } > "${ENV_FILE}"
  printf '%s\n' "Created .env with local-only defaults and generated credentials."
}

run_compose() {
  local compose
  compose="$(compose_command)"
  # Intentional word splitting: compose is either "docker compose" or "docker-compose".
  # shellcheck disable=SC2086
  ${compose} --project-directory "${PROJECT_DIR}" --env-file "${ENV_FILE}" "$@"
}

validate_ipv4() {
  local address="$1"
  local part
  local -a parts
  [[ "${address}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS='.' read -r -a parts <<< "${address}"
  for part in "${parts[@]}"; do
    (( 10#${part} >= 0 && 10#${part} <= 255 )) || return 1
  done
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  local found=0
  mkdir -p "${PROJECT_DIR}/runtime"
  temporary="$(mktemp "${PROJECT_DIR}/runtime/.env.XXXXXX")"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == "${key}="* ]]; then
      printf '%s=%s\n' "${key}" "${value}" >> "${temporary}"
      found=1
    else
      printf '%s\n' "${line}" >> "${temporary}"
    fi
  done < "${ENV_FILE}"
  if (( found == 0 )); then
    printf '%s=%s\n' "${key}" "${value}" >> "${temporary}"
  fi
  chmod 600 "${temporary}"
  mv "${temporary}" "${ENV_FILE}"
}

get_env_value() {
  local key="$1"
  local default_value="${2:-}"
  local line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == "${key}="* ]]; then
      printf '%s\n' "${line#*=}"
      return 0
    fi
  done < "${ENV_FILE}"
  printf '%s\n' "${default_value}"
}

command_name="${1:-help}"
case "${command_name}" in
  init)
    init_environment
    ;;
  up)
    [[ -f "${ENV_FILE}" ]] || init_environment
    run_compose up --detach
    ;;
  down)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Nothing to stop; .env does not exist."
      exit 0
    }
    run_compose down
    ;;
  status)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    run_compose ps
    ;;
  logs)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    run_compose logs --follow --tail 200 "${@:2}"
    ;;
  check)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    curl --fail --silent --show-error http://127.0.0.1:8088/api
    printf '\n'
    curl --fail --silent --show-error http://127.0.0.1:8088/api/sessions
    printf '\n'
    map_logs="$(run_compose logs --no-color --tail 400 map 2>&1)"
    if [[ "${map_logs}" != *"map-server is ready to work"* ]]; then
      printf '%s\n' "Map process is alive but has not completed zone initialization." >&2
      exit 1
    fi
    printf '%s\n' "Map process completed zone initialization."
    ;;
  backup)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    mkdir -p "${BACKUP_DIR}"
    backup_path="${BACKUP_DIR}/xidb-$(date -u +%Y%m%dT%H%M%SZ).sql"
    compose="$(compose_command)"
    # Intentional word splitting: compose is either "docker compose" or "docker-compose".
    # shellcheck disable=SC2086
    ${compose} --project-directory "${PROJECT_DIR}" --env-file "${ENV_FILE}" \
      exec -T database sh -c \
      'exec mariadb-dump --user=root --password="$MARIADB_ROOT_PASSWORD" --single-transaction --routines --events "$MARIADB_DATABASE"' \
      > "${backup_path}"
    chmod 600 "${backup_path}"
    printf 'Created %s\n' "${backup_path}"
    ;;
  verify-backup)
    "${PROJECT_DIR}/scripts/verify-backup.sh" "${2:-}"
    ;;
  scheduled-backup)
    "${PROJECT_DIR}/scripts/scheduled-backup.sh"
    ;;
  restore)
    restore_path="${2:-}"
    confirmation="${3:-}"
    if [[ -z "${restore_path}" || "${confirmation}" != "--yes" ]]; then
      printf '%s\n' \
        "Restore overwrites database objects from a SQL dump." \
        "Usage: ./scripts/server.sh restore /absolute/path/to/xidb.sql --yes"
      exit 1
    fi
    [[ -f "${restore_path}" ]] || {
      printf 'Backup does not exist: %s\n' "${restore_path}" >&2
      exit 1
    }
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    compose="$(compose_command)"
    # Intentional word splitting: compose is either "docker compose" or "docker-compose".
    # shellcheck disable=SC2086
    ${compose} --project-directory "${PROJECT_DIR}" --env-file "${ENV_FILE}" \
      exec -T database sh -c \
      'exec mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' \
      < "${restore_path}"
    printf 'Restored %s\n' "${restore_path}"
    ;;
  set-network)
    network_ip="${2:-}"
    confirmation="${3:-}"
    if [[ -z "${network_ip}" || "${confirmation}" != "--yes" ]]; then
      printf '%s\n' \
        "This changes the game-port bind and advertised zone address." \
        "Usage: ./scripts/server.sh set-network 192.168.1.20 --yes"
      exit 1
    fi
    validate_ipv4 "${network_ip}" || {
      printf 'Invalid IPv4 address: %s\n' "${network_ip}" >&2
      exit 1
    }
    [[ -f "${ENV_FILE}" ]] || init_environment
    registration_value="$(get_env_value LSB_ACCOUNT_CREATION true)"
    if [[ "${network_ip}" != "127.0.0.1" &&
          "${registration_value}" == "true" &&
          "${4:-}" != "--allow-registration" ]]; then
      printf '%s\n' \
        "Refusing LAN binding while unsupervised account registration is enabled." \
        "For a supervised first-account window only, append --allow-registration," \
        "then disable registration immediately after enrollment."
      exit 1
    fi
    set_env_value "LSB_BIND_IP" "${network_ip}"
    set_env_value "LSB_ZONE_IP" "${network_ip}"
    run_compose up --detach
    printf '%s\n' \
      "Game ports now bind to and advertise ${network_ip}." \
      "Telemetry, MariaDB, and AgentBridge remain loopback-only." \
      "Review the host firewall before allowing any other machine to connect."
    ;;
  set-client-address)
    client_ip="${2:-}"
    confirmation="${3:-}"
    if [[ -z "${client_ip}" || "${confirmation}" != "--yes" ]]; then
      printf '%s\n' \
        "This keeps Docker loopback-only while advertising a private host forwarder." \
        "Usage: ./scripts/server.sh set-client-address 10.211.55.2 --yes"
      exit 1
    fi
    validate_ipv4 "${client_ip}" || {
      printf 'Invalid IPv4 address: %s\n' "${client_ip}" >&2
      exit 1
    }
    case "${client_ip}" in
      10.*|192.168.*) ;;
      172.*)
        second_octet="${client_ip#172.}"
        second_octet="${second_octet%%.*}"
        if (( 10#${second_octet} < 16 || 10#${second_octet} > 31 )); then
          printf 'Client address must be an RFC1918 private IPv4 address: %s\n' "${client_ip}" >&2
          exit 1
        fi
        ;;
      *)
        printf 'Client address must be an RFC1918 private IPv4 address: %s\n' "${client_ip}" >&2
        exit 1
        ;;
    esac
    [[ -f "${ENV_FILE}" ]] || init_environment
    registration_value="$(get_env_value LSB_ACCOUNT_CREATION true)"
    if [[ "${registration_value}" == "true" &&
          "${4:-}" != "--allow-registration" ]]; then
      printf '%s\n' \
        "Refusing private-interface forwarding while account registration is enabled." \
        "For the supervised first-account window only, append --allow-registration," \
        "then disable registration immediately after enrollment."
      exit 1
    fi
    set_env_value "LSB_BIND_IP" "127.0.0.1"
    set_env_value "LSB_ZONE_IP" "${client_ip}"
    set_env_value "FFXI_FORWARD_LISTEN_HOST" "${client_ip}"
    run_compose up --detach
    printf '%s\n' \
      "Docker game ports remain loopback-only." \
      "Zones now advertise the private client address ${client_ip}." \
      "Start the bounded host forwarder with: pnpm forwarder"
    ;;
  accounts)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    run_compose exec -T database sh -c \
      'exec mariadb --batch --table --user=root --password="$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE" --execute="SELECT id, login, status, priv, timecreate FROM accounts ORDER BY id"'
    ;;
  registration)
    [[ -f "${ENV_FILE}" ]] || {
      printf '%s\n' "Run ./scripts/server.sh init first."
      exit 1
    }
    registration_action="${2:-status}"
    case "${registration_action}" in
      status)
        registration_value="$(get_env_value LSB_ACCOUNT_CREATION true)"
        printf 'Loader account registration: %s\n' "${registration_value:-true}"
        ;;
      enable|disable)
        [[ "${3:-}" == "--yes" ]] || {
          printf '%s\n' \
            "This changes whether xiloader users can create accounts." \
            "Usage: ./scripts/server.sh registration ${registration_action} --yes"
          exit 1
        }
        [[ -f "${ENV_FILE}" ]] || init_environment
        if [[ "${registration_action}" == "enable" ]]; then
          registration_value=true
        else
          registration_value=false
        fi
        set_env_value "LSB_ACCOUNT_CREATION" "${registration_value}"
        run_compose up --detach --no-deps connect
        printf 'Loader account registration is now %s.\n' "${registration_value}"
        ;;
      *)
        printf '%s\n' "Usage: ./scripts/server.sh registration {status|enable|disable} [--yes]" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    printf '%s\n' \
      "Usage: ./scripts/server.sh {init|up|down|status|logs|check|backup|verify-backup|scheduled-backup|restore|set-network|set-client-address|accounts|registration}" \
      "" \
      "down preserves the database and mesh volumes." \
      "scheduled-backup compresses and verifies each dump before retention." \
      "restore requires an absolute dump path followed by --yes." \
      "set-network requires a validated IPv4 address followed by --yes." \
      "set-client-address keeps Docker loopback-only and configures a private host forwarder." \
      "LAN binding with registration enabled also requires --allow-registration." \
      "registration enable/disable requires --yes and recreates only xi_connect."
    ;;
esac
