# Reactive combat supervisor

## Why this layer exists

An LLM/MCP control loop is appropriate for goals, policy changes, route selection,
and diagnosing exceptions. It is not the right real-time layer for noticing one
incoming hit and issuing `/attack` before several more hits land.

The first bounded supervisor was `scripts/mcp-aggro-guard.mjs`. The current
implementation is `scripts/mcp-farm-supervisor.mjs`: one local process owns
proactive targeting, reactive defense, approach, battle, weapon skills,
recovery, and stop conditions. It keeps one MCP connection open and acts
without per-fight model calls or model tokens.

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

The unified supervisor was validated live later on 2026-07-28:

- A pre-aggroed Young Quadav was attacked in 551 ms, defeated, and yielded
  80 EXP and 6 gil. Combo fired twice, and recovery began only after the kill.
- A clean fight-limited lease defeated two Walking Saplings and one Rock
  Lizard in 69 seconds with zero attack rejections, target-cycle errors,
  deaths, excluded pulls, combat teleports, or combat recovery actions.
- Exact target-follow approach closed the three proactive fights to 0.61,
  0.92, and 1.12 yalms before attack.
- The clean lease counted 160 EXP; the Rock Lizard was too weak to award EXP.
- A separate recovery test restored Pablo from 38% to above 90% while idle.
- Five bounded leases have now produced 11 consecutive approved wins without a
  preventable death. The latest live state is Monk level 11 at 1,199/2,800 EXP.

Live failures also changed the policy:

- Vultures remain proactively excluded. Multiple exact IDs failed attack
  registration after coarse positioning, facing experiments, and target-follow
  approaches as close as 1.13 yalms.
- Explicit heading hold was removed because it interfered with the game's own
  combat facing.
- An aggro-selected exact target is preserved instead of cleared and
  reselected.
- The game-command `/follow <t>` is tried first; if a hostile target does not
  move, a three-second AgentBridge `move_to_entity` lease runs directly toward
  it.
- FFXI reward messages are parsed despite trailing control bytes, and every
  lease baselines the existing event tail before counting rewards.
- A level-up can restore HP while the initial `/heal` command is still queued.
  Unconditionally sending another `/heal` may then put the character into
  healing stance after recovery appears complete. The supervisor now samples
  the live stance, sends the stand toggle only for status 33, and requires two
  fresh idle samples before it resumes positioning. A one-fight lease validated
  the repair.
- The high-elevation pocket near `(-380, -312)` remains diagnostic-only because
  direct target approach moved away from one Sapling. Avoid it in the clean
  baseline until collision-aware movement explains that behavior.

## Usage

South Gustaberg is zone 107:

```sh
pnpm mcp:aggro-guard -- \
  --zone-id 107 \
  --maximum-seconds 900 \
  --maximum-engagements 30 \
  --confirmation "ARM PRIVATE SERVER SOLO AGGRO GUARD"
```

The legacy guard is defensive. The unified supervisor exposes a durable MCP
lease:

```sh
pnpm mcp:farm-start -- \
  --zone-id 107 \
  --maximum-seconds 900 \
  --maximum-fights 30 \
  --confirmation "ARM PRIVATE SERVER FARM SUPERVISOR"

pnpm mcp:farm-status
pnpm mcp:farm-stop -- --lease-id <active-lease-id>
```

`ffxi_farm_start`, `ffxi_farm_status`, and `ffxi_farm_stop` expose the same
controls directly to MCP clients. Runtime state and JSON event logs are stored
under the ignored, owner-only `runtime/farm-supervisor/` directory.

## Next iteration

1. Complete 30 consecutive approved fights.
2. Validate three controlled add handoffs without abandoning the current live
   target.
3. Repeat sub-second reactive measurements with the preserved aggro target.
4. Diagnose Vulture registration separately.
5. Implement and validate death detection plus Home Point return.
6. Record incoming action packets in AgentBridge so aggressor identity remains
   exact on a future shared server.
