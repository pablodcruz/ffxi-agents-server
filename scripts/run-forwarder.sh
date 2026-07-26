#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"

[[ -f "${ENV_FILE}" ]] || {
  printf '%s\n' "Run ./scripts/server.sh init first." >&2
  exit 1
}

while IFS='=' read -r key value; do
  if [[ "${key}" == "FFXI_FORWARD_LISTEN_HOST" && -z "${FFXI_FORWARD_LISTEN_HOST:-}" ]]; then
    FFXI_FORWARD_LISTEN_HOST="${value}"
    export FFXI_FORWARD_LISTEN_HOST
  fi
done < "${ENV_FILE}"

if [[ -z "${FFXI_FORWARD_LISTEN_HOST:-}" ]]; then
  printf '%s\n' "Configure the private interface with server.sh set-client-address first." >&2
  exit 1
fi

exec "${PROJECT_DIR}/scripts/run-node.sh" "${PROJECT_DIR}/src/private-interface-forwarder.mjs"
