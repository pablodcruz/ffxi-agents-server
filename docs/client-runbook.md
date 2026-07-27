# First Windows client runbook

Status: validated with one Windows 11 ARM client
Date: 2026-07-26

This procedure keeps LandSandBoat, AgentBridge, and the MCP process private. It
does not make the setup authorized by Square Enix; review
[research.md](research.md) before proceeding.

## 1. Choose the topology

The recommended first topology is:

```text
Windows x86-64 PC or VM                  This Mac
FFXI + xiloader + Ashita                 LandSandBoat + Codex MCP
AgentBridge on 127.0.0.1:19769  <------  SSH local-forward
                             game ports  Mac LAN IPv4
```

A physical Windows 10/11 x86-64 machine is the lowest-risk compatibility
choice. A Windows VM can work, but its network mode must let it reach the Mac
without exposing the VM directly to the internet.

If the client runs on another machine, note the Mac's stable LAN IPv4. Do not
use a public address. Once selected, take a backup and explicitly change only
the game bindings:

```sh
./scripts/server.sh backup
./scripts/server.sh set-network 192.168.1.20 --yes --allow-registration
```

The command validates the IPv4, updates both the host bind and all 300
`zone_settings.zoneip` rows, and recreates affected services. Telemetry,
MariaDB, and AgentBridge remain loopback-only. To return to local-only mode:

```sh
./scripts/server.sh set-network 127.0.0.1 --yes
```

`--allow-registration` is only for the supervised first-account window. After
the dedicated account is created, immediately run:

```sh
./scripts/server.sh registration disable --yes
```

## 2. Prepare an authorized client

Follow LandSandBoat's current
[Windows client guide](https://github.com/LandSandBoat/server/wiki/Client-Setup-Windows):

1. Install FFXI from Square Enix's official installer.
2. Connect to retail through an authorized account or trial and complete all
   client updates.
3. Enable DirectPlay if Windows requires it.
4. Download the current
   [xiloader release](https://github.com/LandSandBoat/xiloader/releases).
5. Connect once using only `xiloader.exe --server MAC_LAN_IP`.
6. Create a private-server account at xiloader's prompt, log in, and create a
   dedicated test character.

Use a unique private-server password. Do not reuse Square Enix, email, Windows,
or other credentials. Do not add credentials to launcher command-line
arguments.

## 3. Install Ashita and AgentBridge

After plain xiloader works:

1. Install Ashita v4 and create a private-server boot profile that invokes the
   current `xiloader.exe --server MAC_LAN_IP`.
2. Copy `ashita/addons/agentbridge` from this repository to the matching Ashita
   addon directory.
3. Securely copy
   `runtime/agentbridge-config.json` from the Mac to that addon directory and
   rename it to `config.json`.
4. Load AgentBridge from Ashita's normal startup script or with
   `/addon load agentbridge`.
5. Confirm its console message says it is listening on `127.0.0.1:19769` with
   writes disabled.

The token files are mode `0600`, ignored by Git, and generated with:

```sh
./scripts/init-agentbridge.sh
```

Use `--rotate` only if the token is exposed, then replace both the Windows JSON
and Mac runtime environment together.

## 4. Connect the loopback bridge

AgentBridge deliberately refuses LAN binding. If Windows is a separate host,
enable its OpenSSH server and establish this tunnel from the Mac:

```sh
ssh -N -L 19769:127.0.0.1:19769 WINDOWS_USER@WINDOWS_LAN_IP
```

Keep the terminal open. The Mac-side MCP process will connect to its own
`127.0.0.1:19769`, which SSH forwards to Windows loopback. Do not add a Windows
firewall rule for port 19769.

Run both readiness checks:

```sh
pnpm doctor -- --server-only
pnpm doctor -- --bridge-only
```

The bridge check reports whether writes and movement are enabled but never
prints the shared token.

To map a wider visible area without enabling control, increase the bounded
observation limits:

```sh
pnpm mcp:smoke -- --radius 50 --max-entities 64
```

## 5. Validate the first closed loop

In order:

1. `ffxi_server_status` — expect one session and one active zone.
2. `ffxi_control_status` — expect `enabled: false`.
3. `ffxi_observe` — verify the dedicated character and nearby entity data.
4. `ffxi_character_state` without inventory, then with container `0` and a
   small item cap — verify stats, statuses, menu state, recasts, and inventory.
5. `ffxi_enable_control` with the exact confirmation
   `ENABLE PRIVATE SERVER CONTROL`.
6. `ffxi_target_entity` for one harmless nearby NPC.
7. `ffxi_gameplay_command` with `/check <t>`.
8. `ffxi_observe` and recent events — verify the result.
9. `ffxi_move_to_entity` with a five-second timeout only in an open, safe area.
10. `ffxi_stop_movement`.
11. `ffxi_emergency_stop` — verify control is disabled and auto-running is
    false.

For navmesh routes, inspect the exact waypoints and elevation changes without
enabling control:

```sh
pnpm mcp:pathfind -- \
  --mesh South_Gustaberg.nav \
  --x 262.415 --y -280.940 --z -0.089 \
  --plan-only
```

The path runner always calls `ffxi_emergency_stop` when it exits, whether the
route succeeds or fails. This fail-closed behavior prevents a stalled waypoint
from leaving AgentBridge armed. During execution, it may replan from the
character's observed stop position up to two times; `--max-replans 0` disables
recovery, and the accepted range is zero through three.

If the navmesh corridor is disconnected from client collision, use the bounded
probe runner only after a read-only entity scan:

```sh
pnpm mcp:probe-route -- \
  --mesh South_Gustaberg.nav \
  --x 240 --y -305 --z -17 \
  --max-probes 6 \
  --step-distance 3
```

Do not lower its HP floor or entity-clearance defaults merely to force a route.
Inspect `stop_reason`, `final_control`, and the private collision log before
continuing.

For time-gated targets, use the read-only `pnpm mcp:wait-target` helper before
enabling control. Require an exact name, a conservative distance, and a small
elevation difference; a target above or below the character may be separated
by impassable client collision even when its horizontal distance looks safe.

For the first target/check portion, the repository includes a bounded smoke
test that requires an exact nearby entity name:

```sh
pnpm mcp:gameplay-smoke -- --target Loulia
```

It enables control, targets only that entity within ten units, queues
`/check <t>`, captures a new observation, stops movement defensively, and
always calls the emergency stop. Substitute a harmless nearby NPC from the
read-only `pnpm mcp:smoke` output; do not guess a target name.

After the target/check path succeeds, add `--move-to-target` to test one
five-second movement lease:

```sh
pnpm mcp:gameplay-smoke -- --target Loulia --move-to-target
```

The target must begin within ten units by default. After a wide read-only
observation confirms a safe waypoint, `--max-start-distance` can raise that
limit to at most 30 and `--movement-timeout` can raise the lease to at most 20
seconds. Movement still stops at three units, after two seconds without
progress, on target loss, or when the script's defensive stop and emergency
stop run.

Movement is a lease, not an open-ended command. AgentBridge checks progress ten
times per second and stops on arrival, timeout, no progress, target loss,
logout, explicit stop, addon unload, or emergency stop. Keep a hand on the
physical controls during its first live validation.

## 6. Evidence to record

For the first run, retain:

- `pnpm doctor` output;
- the server session and zone telemetry;
- the initial/final observations;
- one bounded detailed-character snapshot, excluding secrets;
- the target, movement parameters, and stop reason;
- any Ashita and LandSandBoat errors;
- confirmation that `ffxi_emergency_stop` leaves writes disabled.

Do not record passwords, bridge tokens, Square Enix credentials, client files,
or DAT assets.

See [troubleshooting.md](troubleshooting.md) for the exact failures observed on
the Apple Silicon/Parallels path, including Colima UDP forwarding,
`FFXI-3001`, stale xiloader TLS sessions, Windows ARM character rendering, and
safe streaming checkpoints.
