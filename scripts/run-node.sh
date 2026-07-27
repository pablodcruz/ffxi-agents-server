#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ENV="${PROJECT_DIR}/runtime/mcp.env"

if [[ -f "${RUNTIME_ENV}" ]]; then
  while IFS='=' read -r key value; do
    case "${key}" in
      FFXI_AGENTS_CONFIG|FFXI_BRIDGE_HOST|FFXI_BRIDGE_PORT|FFXI_BRIDGE_TOKEN|FFXI_INPUT_ADAPTER|FFXI_PARALLELS_VM|LSB_API_URL)
        if [[ -z "${!key:-}" ]]; then
          printf -v "${key}" '%s' "${value}"
          export "${key}"
        fi
        ;;
    esac
  done < "${RUNTIME_ENV}"
fi

node_works() {
  "$1" --version >/dev/null 2>&1
}

RUNTIME_NODE="${XDG_CACHE_HOME:-${HOME}/.cache}/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [[ -n "${FFXI_NODE:-}" ]] && node_works "${FFXI_NODE}"; then
  NODE_BINARY="${FFXI_NODE}"
elif [[ -x "${RUNTIME_NODE}" ]] && node_works "${RUNTIME_NODE}"; then
  NODE_BINARY="${RUNTIME_NODE}"
elif command -v node >/dev/null 2>&1 && node_works "$(command -v node)"; then
  NODE_BINARY="$(command -v node)"
else
  printf '%s\n' "Node.js 20+ was not found. Set FFXI_NODE to a working Node executable." >&2
  exit 1
fi

exec "${NODE_BINARY}" "$@"
