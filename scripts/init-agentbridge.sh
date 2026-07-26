#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${PROJECT_DIR}/runtime"
MCP_ENV="${RUNTIME_DIR}/mcp.env"
ADDON_CONFIG="${RUNTIME_DIR}/agentbridge-config.json"
AGENTS_CONFIG="${RUNTIME_DIR}/agents.json"

if [[ -e "${MCP_ENV}" || -e "${ADDON_CONFIG}" ]]; then
  if [[ "${1:-}" != "--rotate" ]]; then
    if [[ -f "${MCP_ENV}" && -f "${ADDON_CONFIG}" && ! -e "${AGENTS_CONFIG}" ]]; then
      token=""
      while IFS='=' read -r key value; do
        if [[ "${key}" == "FFXI_BRIDGE_TOKEN" ]]; then
          token="${value}"
        fi
      done < "${MCP_ENV}"
      [[ ${#token} -ge 24 ]] || {
        printf '%s\n' "Existing MCP environment does not contain a valid bridge token." >&2
        exit 1
      }
      umask 077
      {
        printf '{\n'
        printf '  "default_agent": "primary",\n'
        printf '  "agents": {\n'
        printf '    "primary": {\n'
        printf '      "host": "127.0.0.1",\n'
        printf '      "port": 19769,\n'
        printf '      "token": "%s"\n' "${token}"
        printf '    }\n'
        printf '  }\n'
        printf '}\n'
      } > "${AGENTS_CONFIG}"
      chmod 600 "${AGENTS_CONFIG}"
      printf 'Created protected agent registry: %s\n' "${AGENTS_CONFIG}"
      exit 0
    fi
    printf '%s\n' \
      "AgentBridge credentials already exist; leaving them unchanged." \
      "Use --rotate only when you intend to replace both client and MCP tokens."
    exit 0
  fi
fi

command -v openssl >/dev/null 2>&1 || {
  printf '%s\n' "OpenSSL is required to generate an AgentBridge token." >&2
  exit 1
}

umask 077
mkdir -p "${RUNTIME_DIR}"
token="$(openssl rand -hex 32)"

{
  printf 'FFXI_BRIDGE_HOST=127.0.0.1\n'
  printf 'FFXI_BRIDGE_PORT=19769\n'
  printf 'FFXI_BRIDGE_TOKEN=%s\n' "${token}"
  printf 'LSB_API_URL=http://127.0.0.1:8088/api\n'
} > "${MCP_ENV}"

{
  printf '{\n'
  printf '  "bind_host": "127.0.0.1",\n'
  printf '  "bind_port": 19769,\n'
  printf '  "token": "%s"\n' "${token}"
  printf '}\n'
} > "${ADDON_CONFIG}"

{
  printf '{\n'
  printf '  "default_agent": "primary",\n'
  printf '  "agents": {\n'
  printf '    "primary": {\n'
  printf '      "host": "127.0.0.1",\n'
  printf '      "port": 19769,\n'
  printf '      "token": "%s"\n' "${token}"
  printf '    }\n'
  printf '  }\n'
  printf '}\n'
} > "${AGENTS_CONFIG}"

chmod 600 "${MCP_ENV}" "${ADDON_CONFIG}" "${AGENTS_CONFIG}"
printf '%s\n' \
  "Created protected AgentBridge configuration:" \
  "  ${MCP_ENV}" \
  "  ${ADDON_CONFIG}" \
  "  ${AGENTS_CONFIG}" \
  "Copy the JSON file to the Windows addon as config.json; do not send it over chat or commit it."
