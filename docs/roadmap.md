# Roadmap

## Phase 0 — research and scaffold

- [x] Confirm the server/client licensing boundary.
- [x] Confirm current LandSandBoat deployment topology and ports.
- [x] Confirm Apple Silicon server image support.
- [x] Verify actual runtime architecture; document that the tested image uses
  x86-64 emulation despite its arm64 manifest entry.
- [x] Identify a structured client observation/action API.
- [x] Scaffold local-only Compose, AgentBridge, and MCP layers.
- [x] Add bridge and MCP contract tests.

## Phase 1 — local server

- [x] Pull the official images and seed navigation/collision meshes.
- [x] Initialize MariaDB and pass all four LandSandBoat process startup checks.
- [x] Verify `/api`, `/api/sessions`, `/api/ips`, and `/api/zones`.
- [x] Pin the tested server, mesh, and database image digests.
- [x] Persist dbtool update state and test database backup creation.
- [x] Validate restore into a disposable database and compare live/restored
  schema and account counts.
- [x] Automate compressed backup creation, isolated restore verification,
  integrity markers, locking, and opt-in retention.

## Phase 2 — one Windows client

- [x] Select a Windows 11 ARM VM on the Apple Silicon Mac for the first
  compatibility attempt, with native x64 Windows as the fallback.
- [x] Write the Apple Silicon VM and clean-client installation runbook.
- [x] Write the topology, tunnel, credential, and first-action runbook.
- [x] Add server-only and bridge-only readiness diagnostics.
- [x] Install the client from Square Enix's official Windows download inside
  the VM and verify its Windows registrations and launch files.
- [x] Update through an authorized Square Enix path and validate the current
  client inside the VM.
- [x] Validate current `xiloader` connectivity through the private server
  launcher path.
- [x] Install Ashita v4 and AgentBridge.
- [x] Validate login, observe, target, and one harmless `/check` command.
- [ ] Promote a dedicated test character to GM only if needed for setup.

## Phase 3 — closed-loop play

- [x] Implement a bounded entity-follow primitive with arrival, timeout,
  progress, target-loss, and logout stops.
- [x] Validate bounded movement against the live Windows client.
- [x] Add bounded MCP-native NPC interaction and menu-input tools that do not
  depend on VM focus.
- [ ] Normalize status/job/zone identifiers into names.
- [x] Add bounded inventory, recast, buffs/debuffs, and menu-state
  observations.
- [x] Validate detailed character observations against the live Windows
  client.
- [ ] Validate exact cursor and selected-item semantics inside FFXI's legacy
  Trade window.
- [ ] Add higher-level skills for travel, combat, recovery, and quest steps.
- [x] Validate exact-ID `/check`, recovery, repeatable combat, and progression
  from Monk level 2 to level 3 against the live client.
- [x] Add a local-only, sanitized in-game activity feed for streamed agent
  actions.
- [x] Record structured, secret-filtered write audit traces.
- [ ] Add higher-level gameplay regression scenarios after a real client works.
- [x] Add a fail-closed write latch and emergency stop that halt movement and
  further write tools.
- [x] Validate emergency stop against the live Windows client.

## Phase 4 — multiple agents and human players

- [x] Add protected per-character bridge profiles and require isolated client
  processes/directories.
- [x] Add per-character MCP routing, loopback enforcement, and write locks.
- [ ] Validate two real isolated Windows clients concurrently.
- [x] Add a closed-enrollment registration workflow and verified backups.
- [ ] Define account recovery, bans, privilege changes, deletion, identity
  verification, and moderation policy before inviting human players.
- [ ] Run load, failure-recovery, and abuse tests.
- [ ] Make an explicit contractual/legal go/no-go decision before any public
  exposure.
- [ ] If approved, deploy to a dedicated Linux host with private administration,
  monitoring, pinned images, and documented source/license compliance.

## Future goal — viewer-directed gameplay

- [ ] Build a separate `ffxi-chat-director` service that reads Restream's
  unified Twitch and YouTube live chat without coupling chat ingestion to the
  agent runtime.
- [ ] Validate commands in shadow mode using a strict prefix, verb, argument
  allowlist, idempotency keys, cooldowns, and an auditable state machine.
- [ ] Add a minimal loopback-only typed goal gateway while keeping this
  repository responsible for final game-state and safety validation.
- [ ] Pilot owner/moderator commands, then timed viewer votes, before allowing
  automatic dispatch of bounded NM goals.
- [ ] Export privacy-preserving command, vote, queue, outcome, and latency
  events to the telemetry lab.

The complete deferred design, safety policy, rollout, and acceptance criteria
are in
[future-viewer-directed-gameplay.md](future-viewer-directed-gameplay.md).

## Decisions that require the operator

1. Where the first Windows client will run.
2. Whether an authorized, current FFXI installation is already available.
3. Whether the experiment should stop at a private local/LAN lab or eventually
   accept the additional risk of a public server.
4. Whether to use a stock modern LandSandBoat ruleset or define a custom era and
   progression model after the vertical slice works.
