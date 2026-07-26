# Private operations runbook

Status: local/LAN laboratory only
Date: 2026-07-25

Public exposure is not approved by this runbook.

## Readiness

```sh
./scripts/server.sh status
./scripts/server.sh check
pnpm doctor -- --server-only
```

Compose health reports database/API or process liveness. `server.sh check` also
requires the current map process to have finished loading all zones.

## Backups

Create a normal local dump:

```sh
./scripts/server.sh backup
```

Verify any dump by restoring it into an isolated, network-disabled disposable
MariaDB container:

```sh
./scripts/server.sh verify-backup /absolute/path/to/xidb.sql
```

The scheduled workflow creates, compresses, restores, checks, and hashes a new
dump:

```sh
./scripts/server.sh scheduled-backup
```

A successful artifact has both files:

```text
xidb-YYYYMMDDTHHMMSSZ.sql.gz
xidb-YYYYMMDDTHHMMSSZ.sql.gz.verified
```

Pruning is disabled by default. Copy verified backups to a separate machine or
object store and perform a restore drill before setting
`FFXI_BACKUP_PRUNE=true`. The Linux systemd template is under
`deploy/systemd/`.

## Account enrollment

LandSandBoat hashes passwords inside its login process. Operators should not
insert plaintext or ad-hoc SQL password hashes.

For a closed enrollment window:

```sh
./scripts/server.sh registration enable --yes
# Have the invited player register through current xiloader.
./scripts/server.sh registration disable --yes
./scripts/server.sh accounts
```

Registration changes recreate only `xi_connect`. Keep registration disabled
outside a supervised enrollment window once the initial accounts exist. Never
ask players for Square Enix, email, or reused passwords.

Account bans, deletion, privilege changes, and recovery are deliberately not
automated yet; they require an auditable moderation and identity-verification
policy before human players are invited.

## Network changes

Game ports remain on loopback until an explicit command:

```sh
./scripts/server.sh backup
./scripts/server.sh set-network MAC_LAN_IPV4 --yes --allow-registration
```

This updates the host bindings and every advertised zone address. The API,
database, and AgentBridge remain on loopback. Return to local-only mode with:

```sh
./scripts/server.sh set-network 127.0.0.1 --yes
```

Omit `--allow-registration` once initial enrollment is complete. The network
command refuses a LAN bind while registration is enabled unless this additional
acknowledgment is present.

### Colima server with a Parallels client

When the game server runs in Colima and the Windows client runs on Parallels,
keep Docker loopback-only and use the private host forwarder:

```sh
colima stop
colima start --port-forwarder grpc
./scripts/server.sh set-client-address 10.211.55.2 --yes --allow-registration
pnpm forwarder
```

Colima's default `ssh` port forwarder carries TCP only. Use `grpc` so Docker's
published map port reaches macOS over UDP as well. The host forwarder refuses
to start on macOS when no process owns the loopback UDP target, preventing a
misleading `FFXI-3001` character-selection timeout.

The forwarder must remain running while clients are connected. It refuses
wildcard and public addresses and exposes only the required FFXI game ports.
TCP and UDP peers expire after 15 minutes without traffic. This window is long
enough for xiloader's interactive account and login prompts, which open their
TLS connection before accepting credentials, while still bounding abandoned
connections.
The first UDP datagram for a new peer is retried once after one second if the
map server has not replied. LandSandBoat creates the pending map session
asynchronously after character selection; under x86 emulation on Apple Silicon,
the original datagram can arrive before that session exists. Any upstream reply
or a second client datagram cancels the retry.
Disable registration immediately after the supervised first account is
created.

Do not use a public address without the separate contractual, firewall,
monitoring, moderation, and hosting decision.

## Multiple controlled characters

Each controlled character needs:

- a separate FFXI/Ashita process;
- an isolated Ashita directory and AgentBridge `config.json`;
- a unique 256-bit token;
- a unique Mac loopback port;
- a distinct `agent_id`.

Create an additional protected profile:

```sh
pnpm agent:add -- healer 19770
```

If the remote client listens on a different loopback port:

```sh
pnpm agent:add -- healer 19770 19769
```

The command writes an ignored `runtime/agentbridge-healer.json` for that
client and adds the token to `runtime/agents.json`. It never prints the token.
For a remote Windows host, forward the configured Mac port to that client's
loopback port with SSH.

All character MCP tools accept optional `agent_id`; omission routes to
`default_agent`. Endpoints are forced to loopback, writes are serialized per
agent, different agents can act concurrently, and emergency/stop requests
bypass the normal write queue. Use `ffxi_agent_profiles` to list routing
metadata without secrets.

After a read-only smoke test succeeds in a private live session, validate the
control safety latch without moving the character or issuing a gameplay
command:

```sh
./scripts/run-node.sh scripts/mcp-smoke.mjs --control-cycle
```

The optional cycle arms control with the required confirmation, reads the
enabled state, and always calls the emergency stop in a `finally` block.

Every attempted write is appended to the ignored, mode-`0600`
`runtime/audit/agent-actions.jsonl` with agent id, operation, bounded
non-secret parameters, outcome, error code, and duration. Observations, chat
contents, tokens, passwords, and credentials are not recorded. Copy or ingest
this log before rotating it; automated log deletion is not configured.

## Upgrade policy

This Compose stack follows LandSandBoat's current container example by using a
pinned instance of `mariadb:lts`. The manual Windows build guide separately
recommends MariaDB 10.11. Do not downgrade an existing MariaDB data directory.

Before any image update:

1. Run a scheduled verified backup.
2. Copy it off-host.
3. Read LandSandBoat and MariaDB release notes.
4. Test the new digests with a disposable restored database.
5. Run database migrations and all startup/readiness checks.
6. Validate one sacrificial client before normal players reconnect.

## Emergency response

For one controlled character, call `ffxi_emergency_stop` with its `agent_id`.
For a bridge failure, close that FFXI client. For a server-wide incident:

```sh
./scripts/server.sh backup
./scripts/server.sh down
```

`down` preserves database and mesh volumes. Do not delete volumes as an
incident-response shortcut.
