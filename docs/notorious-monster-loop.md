# Five-camp notorious-monster loop

## Goal

Build one detached, low-call route that cycles through five useful low-level
notorious monsters on the isolated LandSandBoat server. The route owns exact
placeholder selection, NM priority, guarded zone changes, Trust repair,
reactive defense, inventory stop conditions, and its own bounded lease.
Codex chooses or changes the route; it does not supervise each fight.

This is a private-server workflow. Exact server IDs and guarded service
teleports are local implementation details and must not be reused against
retail or a shared server.

## First route

The route comes from the pinned server's exported mob/drop metadata and NM Lua
`phList` definitions, not from retail guide coordinates.

| Camp | Zone | Exact placeholder IDs | Exact NM IDs | Watched reward |
| --- | ---: | --- | --- | --- |
| Leaping Lizzy | South Gustaberg (107) | `17215867` | `17215868`, `17215888` | Bounding Boots `15351`, 15% |
| Stinging Sophie | North Gustaberg (106) | `17211531`–`17211536`, `17211556`–`17211560` | `17211537`, `17211561` | Beestinger `16486`, 15% |
| Jaggedy-Eared Jack | West Ronfaure (100) | `17187110` | `17187111` | Rabbit Charm `13112`, 1% |
| Spiny Spipi | East Sarutabaruta (116) | `17252656` | `17252657` | Mist Silk Cape `13607`, 15% |
| Hoo Mjuu the Torrent | Giddeus (145) | `17371513` | `17371515` | Zealot's Mitts `12798`, 15%; Monster Signa `17132`, 5% |

The highest NM is Hoo Mjuu at level 16–17. The other four are level 9–11,
so the first route is deliberately conservative for Pablo at level 20 with
Valaineral, Joachim, and Mihli Aliapoh.

## Operating policy

One round should:

1. Refuse to start unless Inventory has a configured number of free slots.
2. Skip a camp if every configured unique watched reward is already present
   in a searched player container.
3. Perform a guarded combat-free zone transition to the camp's first vetted
   observation point and rebuild zone-dismissed Trusts.
4. Sweep a small set of profile-owned observation points. Select only a live
   exact NM or placeholder ID; an NM always outranks its placeholder.
5. Kill each eligible placeholder at most once in that camp visit. After a
   kill, allow a short settlement/spawn window, rescan for the NM, then move
   to the next camp. Do not wait through a five-minute respawn.
6. Defend against a real engaged threat through the existing reactive path,
   but never broaden proactive admission to unrelated mobs.
7. Update the local overlay with route round, camp number/name, placeholder
   progress, and collected reward count.

Cycling is the timer strategy. The live Lizzy calibration measured about
five to five-and-a-half minutes between placeholder kills. A five-camp round
should naturally exceed that interval, making the earlier placeholders ready
again without idle camping.

## Live Lizzy calibration

The 2026-07-30 bounded run proved the first exact-lottery profile:

- The supervisor killed only Rock Lizard `17215867` proactively.
- Four placeholder kills produced no Leaping Lizzy spawn, consistent with the
  local 10% pure-lottery rule.
- The observed intervals between placeholder kills were approximately
  5:13, 5:34, and 5:39.
- Three incidental Quadav threats were handled reactively.
- The 20-minute lease stopped on `time_limit` with seven total fights and
  zero deaths.

The experiment also showed what not to retain: four-point scanning every two
seconds produced 327 guarded relocations. The route implementation should
derive compact per-camp observation points from placeholder/spawn data, scan
at a slower bounded cadence, and move to the next camp after one pass.

## Implementation checkpoints

1. Move NM profiles out of the farm script into a validated data module.
2. Add a route policy that tracks camp, round, per-visit placeholder kills,
   watched rewards, respawn cooldowns, and completion reasons.
3. Add a detached route manager and `start/status/stop` MCP surface with the
   same lease ownership, confirmation, runtime permissions, and emergency
   disarm contract as the farm supervisor.
4. Unit-test exact-ID exclusion, NM-over-placeholder priority, multi-
   placeholder Sophie behavior, owned-item skipping, inventory pressure,
   route advancement, reactive-defense precedence, and time/round limits.
5. Dry-run every camp as observation-only, then live-validate one bounded
   five-camp round before enabling repeated rounds.
