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
| `ffxi_emergency_stop` | Yes | Disarm writes, movement, and combat immediately |
| `ffxi_stop_movement` | Yes | Cancel a movement lease |
| `ffxi_target_entity` | Yes | Select one nearby entity |
| `ffxi_move_to_entity` | Yes | Start a short, progress-checked auto-follow lease |
| `ffxi_gameplay_command` | Yes | Queue one allowlisted gameplay command |

The MCP server marks observation tools read-only and uses write approvals for
game actions. The Ashita addon repeats the command allowlist so bypassing the
MCP validation is not sufficient to execute an arbitrary command.

Each character profile resolves to a unique loopback endpoint and token.
Non-loopback bridge hosts are rejected at startup. MCP writes are serialized
per character while different characters remain independent; emergency stop
and movement stop are urgent operations that do not wait behind the normal
write queue. Every write attempt produces a restricted JSONL audit record;
secret-shaped fields and observation/chat payloads are excluded.

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
  console commands, scripts, or GM commands.

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

Long open-loop command sequences are deliberately excluded. The first movement
primitive uses Ashita's wrapped auto-follow state and targets only a nearby
entity. It checks progress at 100 ms intervals and has hard arrival, timeout,
stuck, target-loss, logout, explicit-stop, and emergency-stop exits. Arbitrary
coordinate navigation and OS input remain outside the interface.

Detailed character perception is a separate bounded read. Recasts are capped
and inventory is limited to one requested container with an item-count cap per
call. Ability and spell timers use the SDK's documented 1/60-second tick
conversion. Status-effect timers remain labeled as raw client values because
their unit is not documented with the same confidence. Binary item `Extra`
data is never exposed.
