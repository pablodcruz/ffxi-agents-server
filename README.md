# FFXI Agent Lab

This repository is a local-first prototype for running a LandSandBoat FFXI
server and letting Codex control one private-server character through a narrow
MCP interface.

The important distinction is that **FFXI is not open source**. LandSandBoat is
an open-source GPLv3 server emulator. The Windows client, game assets, and
Square Enix services remain proprietary and are not included here.

## What exists now

- A Docker Compose deployment based on LandSandBoat's official container layout.
- Local-only game port bindings by default and a loopback-only telemetry API.
- A stdio MCP server with bounded world/character observations, targeting,
  server-status, and allowlisted gameplay-command tools.
- An Ashita v4 addon that exposes client state over an authenticated,
  loopback-only JSON-lines socket.
- Read-only character detail for stats, buffs, menu state, active recasts, and
  one explicitly requested inventory container at a time, including the exact
  focused-menu name and numeric ID of an item selected in an open menu.
- A fail-closed write latch, emergency stop, and leased entity-follow movement
  with timeout and progress checks.
- Camera-independent world-coordinate movement plus a host-side
  LandSandBoat/Recast navmesh path-planning prototype.
- Guarded NPC interaction/dialogue helpers and a bounded combat orchestrator
  with exact-entity verification, pre-fight recovery, health-floor, timeout,
  `/attackoff`, and emergency-stop behavior.
- Allowlisted, automatically released DirectInput menu pulses through
  AgentBridge, avoiding VM focus and camera dependence.
- Automated tests for MCP discovery, bridge authentication, telemetry,
  fail-closed control, movement contracts, and command safety.

The first end-to-end client is now validated on Windows 11 ARM under Parallels:
Pablo entered Bastok Markets, AgentBridge exposed live state through the
restricted tunnel, all 18 MCP tools were discovered, and the control latch was
used to target and check a nearby NPC. A five-second movement lease moved Pablo
from 7.52 to 2.67 units from that NPC, stopped on arrival, and finished with
control disabled by the emergency stop. A later navmesh run completed 21
waypoints to Nbu Latteh, accepted **Mom, the Adventurer?**, obtained the quest's
Fire Crystal, crossed the Bastok Markets zone line, loaded South Gustaberg, and
navigated near level-one Huge Hornets without camera steering. Later bounded
fights raised Pablo to Monk level 3. A subdivided navmesh route then crossed
from South Gustaberg back into Bastok Markets and reached Reet without camera
steering. An exact-ID `/item` handoff then exchanged the Adventurer Coupon for
50 gil through guarded dialogue. Three more exact-ID, game-rated easy-prey
Tunnel Worm fights advanced Pablo to 610/1000 EXP at Monk level 3 while
geometry-blocked targets and an even-match Vulture failed closed. The
local-only activity feed gives a stream audience sanitized summaries of
navigation, combat, and menu actions without sending server chat.

## Architecture

```text
Codex
  |
  | stdio MCP
  v
FFXI control server (Node.js)
  |                         \
  | authenticated TCP        \ HTTP telemetry
  | 127.0.0.1 only            \
  v                            v
Ashita AgentBridge addon     LandSandBoat xi_world
  |
  v
FFXI Windows client  <---->  LandSandBoat game services + MariaDB
```

The client bridge is the source of real-time character state and actions.
LandSandBoat's built-in HTTP API is useful for server telemetry, but it does not
control characters.

## Start the server

Prerequisites:

- Docker Engine or Docker Desktop
- Docker Compose v2 (`docker compose` or `docker-compose`)
- Enough disk for the server, MariaDB, and navigation/collision mesh images

```sh
./scripts/server.sh init
./scripts/server.sh up
./scripts/server.sh status
./scripts/server.sh check
```

`init` creates an ignored `.env` with generated database passwords. `down`
preserves the database and mesh volumes:

Compose health checks report database/API or process liveness. `check` is the
stronger readiness gate: it also requires the current map container to have
completed all-zone initialization.

```sh
./scripts/server.sh backup
./scripts/server.sh down
```

Backups are written with mode `0600` under the ignored `runtime/backups`
directory. Restore is deliberately explicit:

```sh
./scripts/server.sh restore /absolute/path/to/xidb.sql --yes
```

Do not change `LSB_BIND_IP` from `127.0.0.1` until the network and client plan
in [docs/architecture.md](docs/architecture.md) has been reviewed.
The selected Parallels topology keeps that bind unchanged and uses the bounded
`pnpm forwarder` process described in the Windows ARM runbook.

## Install the MCP dependencies

Node.js 20 or newer is required.

```sh
pnpm install
pnpm test
```

The repository contains a project-scoped Codex MCP entry in
`.codex/config.toml`. Codex must restart after the initial dependency install or
after MCP configuration changes.

## Install the Windows client bridge

The complete topology-dependent procedure is in
[docs/client-runbook.md](docs/client-runbook.md).
The selected Apple Silicon VM procedure is in
[docs/windows-arm-vm-runbook.md](docs/windows-arm-vm-runbook.md).
Failures encountered on the tested path and their verified fixes are in
[docs/troubleshooting.md](docs/troubleshooting.md).
The movement primitives, mesh provenance, live route results, and remaining
quest/combat work are in [docs/navigation.md](docs/navigation.md).
The addon comparison and MCP-native read-only mob scout are in
[docs/addon-tooling.md](docs/addon-tooling.md).
The researched bot architecture, bounded aggro guard, and shared-server
limitations are in [docs/combat-supervisor.md](docs/combat-supervisor.md).
Bastok Rank 1-3 mission/menu findings are tracked in
[docs/bastok-rank-missions.md](docs/bastok-rank-missions.md).
The current ordered gameplay objectives and acceptance criteria are in
[goal.md](goal.md).

1. Install and update FFXI through an authorized Square Enix path.
2. Confirm the client connects to the private server with current `xiloader`
   before adding Ashita.
3. Install Ashita v4.
4. Copy `ashita/addons/agentbridge` into Ashita's `addons` directory.
5. Rename `config.example.json` to `config.json`.
6. Replace the token with a random value of at least 24 characters.
7. Set the same value as `FFXI_BRIDGE_TOKEN` in the environment that starts
   Codex.
8. Load the addon with Ashita's normal addon loader.

Generate the protected matching MCP/addon configuration before copying it:

```sh
./scripts/init-agentbridge.sh
pnpm doctor -- --server-only
```

The bridge refuses non-loopback binding. If Codex and the client run on
different machines, use an authenticated tunnel or run the MCP process beside
the Windows client; do not expose the bridge port directly.

## Safety boundary

This prototype is for an isolated private-server lab only.

- Never point the agent bridge at retail FFXI.
- Never distribute the FFXI client, DAT files, credentials, or copyrighted game
  assets.
- Arbitrary GM, chat, console, addon-management, script, packet-injection, and
  chained commands are not exposed to the agent. One guarded private-server
  service-teleport operation accepts only typed coordinates, an explicit zone,
  an allowlisted service reason, and a hard confirmation phrase.
- The optional stream activity feed writes sanitized summaries only to the
  local game chat window and a six-line Ashita overlay captured by OBS; it
  cannot send server chat or arbitrary text.
- Agent writes start disabled and must be explicitly armed after every addon
  load or emergency stop.
- Bounded movement automatically stops on arrival, timeout, lack of progress,
  target loss, logout, addon unload, or emergency stop.
- In-game chat and entity names are treated as untrusted data.
- Public hosting is deliberately not automated yet.

See [docs/research.md](docs/research.md) for current findings and the contractual
risk, [docs/operations.md](docs/operations.md) for private operations and
multi-character routing, [docs/troubleshooting.md](docs/troubleshooting.md) for
failure recovery, and [docs/roadmap.md](docs/roadmap.md) for the remaining
work.
