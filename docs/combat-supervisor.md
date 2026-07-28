# Reactive combat supervisor

## Why this layer exists

An LLM/MCP control loop is appropriate for goals, policy changes, route selection,
and diagnosing exceptions. It is not the right real-time layer for noticing one
incoming hit and issuing `/attack` before several more hits land.

The first bounded supervisor is `scripts/mcp-aggro-guard.mjs`. It keeps one local
MCP connection open and polls AgentBridge without consuming model tokens.

## Research basis

[EasyFarm](https://github.com/EasyFarm/EasyFarm) used a finite-state design with
separate targeting, pulling, approach, battle, weapon-skill, healing, trust,
travel, and death states. Its useful lesson is the decomposition, not its
runtime: the repository was archived in 2024 and depends on the older EliteMMO
memory API.

[Ashita v4's example addon](https://github.com/AshitaXI/example) demonstrates
incoming packet and text events plus coroutine work. That makes a future
client-side event detector possible. The first version stays host-side because
our existing AgentBridge observations, guarded writes, audit trail, and tests
already live there.

[Pathfinder](https://github.com/xathei/Pathfinder) remains relevant to
navigation. It exposes navmesh path and wall-edge operations, but it does not
replace combat-state handling.

## Current safety contract

The guard:

- requires an exact zone ID and an explicit private-solo confirmation;
- expires after a bounded duration or engagement count;
- considers only live entities already in fighting status;
- excludes Pablo and every active party member;
- preserves the exact current engaged target, then chooses the nearest add;
- bypasses `/check` only for reactive defense;
- targets by exact server ID, attacks, and uses a configured weapon skill at
  1000 TP;
- re-arms its own guarded control lease before reactive writes so a separate
  high-level MCP action can still finish with its normal emergency stop;
- stops on logout, zoning, death, signal, or lease expiration;
- performs an emergency stop when it exits.

The private-solo confirmation is important. Entity fighting status alone cannot
distinguish aggro from a link or another player's claimed target. Before this is
safe on a shared public server, AgentBridge must expose claim/target ownership or
derive it from incoming action packets.

## Live validation

On 2026-07-28, Pablo (MNK 10) and Naji were placed near an isolated level 3–4
Young Quadav in South Gustaberg. The mob initiated combat. The guard selected
exact server ID `17215677` at 2.66 yalms and issued the defensive attack without
an LLM decision or `/check`. Naji defeated it, Pablo remained at 97% HP, and the
server awarded 80 EXP and 6 gil. The guard then returned to idle and stopped at
its two-minute lease boundary.

## Usage

South Gustaberg is zone 107:

```sh
pnpm mcp:aggro-guard -- \
  --zone-id 107 \
  --maximum-seconds 900 \
  --maximum-engagements 30 \
  --confirmation "ARM PRIVATE SERVER SOLO AGGRO GUARD"
```

The guard is defensive. Proactive mob selection and positioning remain separate
until both loops have been validated together.

## Next iteration

1. Record incoming action packets in AgentBridge so aggressor identity is exact.
2. Add a shared farm lease combining proactive pulls with the defensive guard.
3. Queue adds without resetting a healthy current engagement.
4. Add recovery and death-return states.
5. Expose `start`, `status`, and `stop` as MCP tools backed by a durable local
   supervisor process.
