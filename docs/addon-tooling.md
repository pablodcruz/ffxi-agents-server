# Addon and navigation tooling assessment

Status: read-only scout selected; optional visual companions deferred
Date: 2026-07-27

## Decision

Keep AgentBridge, exact server IDs, a fresh in-game `/check`, and bounded
LandSandBoat-navmesh movement as the gameplay authority. Add a read-only host
scout that joins the live MCP entity scan to the matching LandSandBoat spawn,
level range, aggro/link flags, and conservative vendor-value drop metadata.

Do not delegate target identity, combat approval, or path execution to a
third-party addon. Visual addons may be useful for the operator and stream, but
they are not the machine-control boundary.

## Candidate review

| Tool | Useful for | Decision |
|---|---|---|
| [MobDB](https://github.com/ThornyFFXI/mobdb) | On-screen mob ID, level range, aggro/link flags, position, resistances, and drops; it can generate data for an exact LSB private server | Best visual pilot. Use as a read-only mirror after pinning and reviewing the source; do not make MCP depend on its UI |
| [Ashita distance addon](https://github.com/AshitaXI/Ashita-v4beta/tree/main/addons/distance) | Target distance overlay | Optional stream/operator aid; AgentBridge already returns exact numeric distance |
| Ashita minimap plugin | Human spatial context and nearby dots | Optional stream/operator aid; it does not provide route planning or a stable agent API |
| [Shorthand](https://github.com/ThornyFFXI/Shorthand) | Convenient partial-name commands | Do not use for autonomous targeting because “best matching” names weaken exact-ID disambiguation |
| Find / FindAll | Inventory lookup | Useful later for inventory management, not for finding mobs or moving |
| Allmaps / remastered map DATs | Better human map labels | Optional human aid; visual-only and unnecessary for the MCP route planner |
| Farm/bot/nav addons | Closed-loop automation | Do not adopt. They duplicate policy, obscure failure modes, and commonly lack our exact `/check`, write-latch, audit, and emergency-stop boundaries |

MobDB is unusually relevant because its documented custom-server import path
accepts LandSandBoat SQL inputs. Its tokens include the numeric server ID,
level/range, coordinates, aggro/link flags, and drops. That makes it a good
audience-facing representation of the same facts used by the agent. It remains
an overlay, not a targeting oracle.

## MCP-native read-only scout

Export one zone from the running local LandSandBoat database:

```sh
pnpm mobs:export -- --zone-id 107
```

The export is written beneath ignored `runtime/mob-metadata/` with mode `0600`.
It contains no account, character, token, or chat data.

Rank the live nearby mobs without arming AgentBridge:

```sh
pnpm mcp:scout -- --radius 50 --limit 12
```

The scout:

- reads live entity ID, position, distance, HP, and status through MCP;
- identifies the player's live zone and level;
- constrains the export to that zone's 0x1000 entity-ID block (LSB `groupid`
  values are reused across zones), then joins exact server IDs;
- rejects inactive entities, vertical separation, missing metadata,
  aggressive/linking mobs, and the current hornet family exclusion;
- distinguishes a conservative low-risk level range from a target that still
  needs extra caution;
- estimates vendor value only from explicit nonzero drop and group rates; and
- never enables control, moves, targets, checks, or attacks.

Every actionable recommendation still requires the ordinary exact-ID
`mcp:check-target` result immediately before combat. Database level ranges are
planning hints, not a substitute for the live game verdict.

Tunnel Worms periodically burrow and become temporarily untargetable even
while their entity may remain observable. For a nearby exact worm, let the
check helper retry short target-selection attempts while control is disarmed
between attempts:

```sh
pnpm mcp:check-target -- \
  --target "Tunnel Worm" \
  --server-id 17215531 \
  --maximum-distance 8 \
  --targetability-timeout 20 \
  --retry-seconds 2
```

Do not interpret one refused selection as a wall, and do not chase the worm
until the bounded targetability wait has expired. A kill still has a separate
respawn delay.

The higher-level loop should retain a temporary cooldown for an exact ID that
exhausted the targetability wait. The scout accepts repeatable cooldown IDs and
keeps them visible with an explicit rejection reason:

```sh
pnpm mcp:scout -- \
  --radius 50 \
  --exclude-server-id 17215658
```

Time-gated mobs such as Ding Bats can also despawn after the initial scan.
Always refresh the scan at the route endpoint; discovery is not a reservation.

## Live validation

The first South Gustaberg export was correctly rejected during validation
because joining only on `groupid` produced 65,814 cross-zone rows. Constraining
the query to zone 107's mob-ID block produced 513 rows. This is why the exporter
enforces both the group/zone join and the encoded entity-ID range.

At Monk level 4, the live scout:

- recommended passive, non-linking Tunnel Worm `17215530`;
- rejected nearby hornets and a linking Vulture with explicit reasons;
- led to a successful fresh `/check`, exact-ID defeat, and 120 EXP;
- repeated successfully for Tunnel Worm `17215531`;
- identified higher-value Stone Eater `17215658`, but the client refused exact
  selection for the full bounded 20-second targetability window, so no check or
  attack was sent; and
- selected a Ding Bats fallback that despawned before arrival; the endpoint
  refresh returned no candidate and no action was sent.

Pablo advanced from 600 to 840 EXP out of 1250 at level 4 during this
validation. No sellable item dropped, so the 10,000-gil milestone remains at
the 80-gil baseline.

## Why this is better than replacing the current loop

The current route layer already uses LandSandBoat's own Recast/Detour navmesh
and Ashita's world-vector movement, so it is camera-independent and
machine-readable. Its known weakness is client/server collision mismatch at a
few edges, which is visible and fail-closed. A minimap makes that easier for a
human to understand but does not fix it.

The new scout addresses the separate discovery problem: it converts an
unlabeled radius scan into explainable candidates before the agent spends time
approaching them. Exact-ID targeting and `/check` then remain the final safety
gate. This preserves one observable control loop instead of nesting another
automation system inside it.
