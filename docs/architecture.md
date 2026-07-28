# Architecture decision

Status: local prototype selected, public deployment deferred
Date: 2026-07-25

## Decision

Use three independently replaceable layers:

1. **LandSandBoat** for the emulated FFXI world and persistence.
2. **Ashita AgentBridge** inside a legitimately installed Windows client for
   real-time observations and bounded actions.
3. **A stdio MCP server** as the policy and tool boundary presented to Codex.

Do not add agent-control endpoints to LandSandBoat core for the first vertical
slice. Server-side control alone cannot reproduce the observations and UI state
available to a real client, and a fork would make upstream updates harder.

## Why MCP fits

MCP gives Codex typed, auditable tools rather than unconstrained keyboard or
packet control. The initial tool set is intentionally small:

| Tool | State change | Purpose |
|---|---:|---|
| `ffxi_server_status` | No | Read LandSandBoat session/zone telemetry |
| `ffxi_agent_profiles` | No | List per-character routing without tokens |
| `ffxi_control_status` | No | Read the client-side write latch and movement lease |
| `ffxi_observe` | No | Read player, target, party, nearby entities, and events |
| `ffxi_character_state` | No | Read bounded stats, statuses, recasts, menu state, and one inventory container |
| `ffxi_recent_events` | No | Read a bounded event tail |
| `ffxi_enable_control` | Yes | Explicitly arm private-server client writes |
| `ffxi_set_activity_feed` | Yes | Toggle sanitized action summaries in local game chat only |
| `ffxi_set_goal_overlay` | Yes | Display numeric gil-goal progress in a fixed-purpose local overlay |
| `ffxi_emergency_stop` | Yes | Disarm writes, movement, and combat immediately |
| `ffxi_stop_movement` | Yes | Cancel a movement lease |
| `ffxi_target_entity` | Yes | Select one nearby entity |
| `ffxi_move_to_entity` | Yes | Start a short, progress-checked auto-follow lease |
| `ffxi_move_to_position` | Yes | Move toward one bounded world-coordinate waypoint |
| `ffxi_directional_input` | Yes | Send one automatically released fallback input pulse |
| `ffxi_gameplay_command` | Yes | Queue one allowlisted gameplay command, including a standard NPC trade window |
| `ffxi_farm_start` | Yes | Start one bounded local proactive/reactive combat lease |
| `ffxi_farm_status` | No | Read the lease phase, target, counters, and latency metrics |
| `ffxi_farm_stop` | Yes | Cooperatively stop the current exact lease |

The MCP server marks observation tools read-only and uses write approvals for
game actions. The Ashita addon repeats the command allowlist so bypassing the
MCP validation is not sufficient to execute an arbitrary command.

Each character profile resolves to a unique loopback endpoint and token.
Non-loopback bridge hosts are rejected at startup. MCP writes are serialized
per character while different characters remain independent; emergency stop
and movement stop are urgent operations that do not wait behind the normal
write queue. Every write attempt produces a restricted JSONL audit record;
secret-shaped fields and observation/chat payloads are excluded.

### Local stream activity feed

AgentBridge can mirror a narrow subset of its own internal action events into
the local FFXI chat window. The feed is disabled by default and can be toggled
with:

```sh
pnpm mcp:feed -- --enabled true
```

It displays target selections, bounded movement start/stop events, input
pulses, heading changes, and only the verb of an allowlisted gameplay command.
It accepts no arbitrary message string, strips control characters, truncates
output, and never sends `/say`, `/tell`, linkshell, or any other server chat.
Normal combat, EXP, and `/check` results remain the game's own chat events.

The separate goal banner above the activity feed displays only numeric gil
progress with a fixed label:

```sh
pnpm mcp:goal -- --enabled true --current-gil 80 --target-gil 10000
```

It accepts no arbitrary message text and never sends server chat. Update it at
meaningful checkpoints such as a vendor sale rather than after every fight.

### Guarded private-server service teleport

Unverified service travel now defaults to the dedicated
`ffxi_service_teleport` MCP operation. AgentBridge 0.20.0 accepts typed
coordinates, an explicit zone, an allowlisted service reason, and a hard
confirmation phrase. It queues a validated LandSandBoat `!pos` command only
after confirming the character is logged in, idle, and outside menus.

This capability remains separate from `ffxi_gameplay_command`: no arbitrary GM
command string crosses MCP, and the normal command validator still rejects GM,
chat, addon, console, script, and chained commands. The local character has
audited GM level 1 only so LandSandBoat will accept this dedicated operation.

The allowlisted reasons are vendor travel, registered travel-node travel,
bounded pre-combat positioning, and stuck recovery. Pre-combat positioning
places the character at a safe offset from one policy-approved target; it does
not run during an active fight or change combat outcomes. Same-zone positioning
omits LandSandBoat's zone argument so it does not reload the area or dismiss
Trusts. Normal movement remains available for routes that have already
completed reliably and been cached.

## Trust boundaries

### FFXI client

The client is proprietary. It must be installed and updated through an
authorized Square Enix path. This repository contains no client files or game
assets.

### Ashita bridge

- Binds only to `127.0.0.1`.
- Requires a shared token of at least 24 characters.
- Accepts one JSON-lines request per connection.
- Caps request size and observation result size.
- Does not expose raw packet injection, Lua evaluation, arbitrary files, chat,
  console commands, scripts, or arbitrary GM commands. The guarded service
  teleport is the sole dedicated GM-backed operation.

If Codex is not on the Windows client host, the preferred order is:

1. Run the stdio MCP server on that Windows host.
2. Use Codex remote-machine support or a secured tunnel to that host.
3. Only if necessary, wrap MCP in authenticated Streamable HTTP.

Directly binding the Ashita socket to a LAN or public interface is outside the
design.

### LandSandBoat

- MariaDB is not published to the host.
- The HTTP API is published on `127.0.0.1:8088` only.
- Game ports are published on `127.0.0.1` by default.
- The built-in IP rules remain enabled.
- Public exposure requires a separate network review, backups, rate limits,
  logging, and a decision about the Square Enix agreement risk.

## Networking

LandSandBoat uses the following client-facing ports:

| Protocol | Port | Component |
|---|---:|---|
| TCP | 54001 | Login view |
| TCP | 54002 | Search |
| TCP | 54230 | Login data |
| TCP | 54231 | Login auth |
| UDP | 54230 | Map/game traffic |

The optional HTTP telemetry API uses TCP 8088. It provides session counts,
unique IP counts, per-zone counts, and filtered settings. It is not an agent
action API.

For a Windows client on the same LAN as the Mac server:

1. Set `LSB_BIND_IP` to the Mac's stable LAN IP.
2. Update every `zone_settings.zoneip` value to that same reachable address.
3. Allow the five game port/protocol combinations through the Mac and VM
   firewalls.
4. Keep port 8088, MariaDB, and AgentBridge loopback-only.

For the selected Parallels-on-Colima topology, Docker cannot publish directly
on Parallels' host adapter. Keep Docker on `127.0.0.1`, advertise the verified
Parallels host address with `set-client-address`, and run the bounded host
forwarder. The forwarder accepts only an RFC1918 listen address and forwards
only TCP 54001, 54002, 54230, 54231 and UDP 54230 to loopback. It does not
forward telemetry or MariaDB.

For future public players, prefer a dedicated Linux host rather than a personal
Mac. Pin container images by digest, automate database backups, monitor the four
LandSandBoat processes, and put administration behind a private VPN.

## Control loop

The expected agent loop is:

1. Observe.
2. Choose one short action.
3. Execute the action.
4. Wait only as long as the game mechanic requires.
5. Observe again and verify the result.

Long open-loop command sequences are deliberately excluded. Entity movement
uses Ashita's wrapped auto-follow target state. Coordinate movement uses
Ashita's world-space `FollowDeltaX/Y` vector and recomputes it every 100 ms,
independently of the camera. Both have hard arrival, timeout, stuck, logout,
explicit-stop, and emergency-stop exits. A host-side Recast/Detour planner
queries LandSandBoat's own ignored runtime navmesh and sends one short waypoint
lease at a time. See [navigation.md](navigation.md).

Detailed character perception is a separate bounded read. Recasts are capped
and inventory is limited to one requested container with an item-count cap per
call. Ability and spell timers use the SDK's documented 1/60-second tick
conversion. Status-effect timers remain labeled as raw client values because
their unit is not documented with the same confidence. Binary item `Extra`
data is never exposed.
