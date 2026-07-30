# Four-camp notorious-monster loop

## Goal

Build one detached, low-call route that cycles through four useful low-level
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
All four NMs are level 9–11, so the route is deliberately conservative for
Pablo at level 20 with Valaineral, Joachim, and Mihli Aliapoh.

## Operating policy

One round should:

1. Refuse to start unless Inventory has a configured number of free slots.
2. Skip a camp if every configured unique watched reward is already present
   in a searched player container.
3. Perform a guarded combat-free zone transition to the camp's first vetted
   observation point, wait twelve seconds for the zone transition to settle,
   and rebuild zone-dismissed Trusts.
4. Sweep a small set of profile-owned observation points. Select only a live
   exact NM or placeholder ID; an NM always outranks its placeholder.
5. Kill each eligible placeholder at most once in that camp visit, then move
   immediately to the next camp. Do not rescan after the configured
   placeholder quota is dead and do not wait through a five-minute respawn.
6. Defend against a real engaged threat through the existing reactive path,
   but never broaden proactive admission to unrelated mobs.
7. Update the local overlay with route round, camp number/name, placeholder
   progress, and collected reward count.
8. After the final round drains every reactive fight, return to the validated
   Bastok Markets safe endpoint before disarming.

Cycling is the timer strategy. The live Lizzy calibration measured about
five to five-and-a-half minutes between placeholder kills. A four-camp round
can be shorter, so a repeated round may simply sweep past a placeholder that
has not respawned yet instead of waiting in place.

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

## Early five-camp live validation

The 2026-07-30 one-round lease completed normally in 8 minutes 40 seconds with
`nm_route_complete`:

- Five camps completed and all five cross-zone entries settled.
- Seven exact placeholders were killed: one each for Lizzy, Jack, Spipi, and
  Hoo Mjuu, plus three distinct Sophie placeholders.
- No NM spawned and no watched rare item dropped during this round.
- Five unrelated mobs that actually engaged Pablo or a Trust were handled by
  the reactive path. All five occurred in the final Giddeus pocket; maximum
  observed handoff queue time was 1,629 ms.
- The run completed 12 fights, earned 1,140 EXP and 96 gil, and had zero
  deaths, zero recovery cycles, zero teleports while engaged, and zero
  recovery commands while engaged.
- Twenty-two slower profile-owned sweeps replaced the earlier Lizzy
  experiment's 327 two-second relocations.
- One stale exact-target race and four attack-registration/visibility
  rejections recovered through the existing bounded retry paths.
- Inventory moved from 17/30 to 21/30 and retained nine free slots, above the
  configured five-slot stop threshold.

The first build stopped safely but remained in the Giddeus camp. A nearby
Digger Wasp began hitting Pablo after control disarmed, proving that
"combat-free at stop time" was not a sufficient unattended exit condition.
Pablo was moved to the validated Bastok Markets endpoint
`(-304, -161.5, -10.32)` in zone 235, and the durable route now performs that
same guarded cross-zone exit before it reports a completed final round.

Later validation found that Hoo's dense Giddeus pocket added too much risk and
latency for this low-level loop. One run killed Spiny Spipi itself, proving NM
priority, but entered Giddeus before Trust reconstruction completed and died.
A staging-point revision assembled all three Trusts successfully and killed
Hoo's placeholder plus four linked enemies, but inventory pressure disarmed
the lease while Pablo remained in the aggro pocket; two later enemies then
defeated him. The inventory guard now drains reactive combat and safe-exits
before disarming, and Hoo Mjuu has been removed from this route.

## Four-camp live validation

The 2026-07-30 simplified one-round lease completed normally in 4 minutes
12 seconds with `nm_route_complete`:

- Four camps completed and the final safe exit returned Pablo to Bastok
  Markets.
- Six exact placeholders were killed: one each for Lizzy, Jack, and Spipi,
  plus three distinct Sophie placeholders.
- Every camp advanced immediately after its configured placeholder quota; no
  post-placeholder NM scan or repeated sweep occurred.
- The initial two-second post-zone delay still produced a failed first Trust
  cast in every new zone. A subsequent five-second trial failed the same way.
  The durable route now waits twelve seconds before the first cast and two
  seconds after each successful summon before trying the next Trust.
- There were zero deaths, reactive engagements, combat recoveries, teleports
  while engaged, or recovery commands while engaged.
- No NM spawned and no watched rare item dropped in this round.

A subsequent full round killed Leaping Lizzy, completed safely in 3 minutes
53 seconds, and displayed `NMS KILLED 1` on both the active and completion
overlays. Its five-second delay still failed the first Trust cast in every
zone. A final stopped validation used the twelve-second delay across the
Lizzy and Sophie transitions: all six Trust summons succeeded on pass one
with no unavailable-cast events.

## Controls

The route reuses the detached farm lease and its existing start/status/stop
surface. Route mode owns targeting and travel, so quest-item, target-level,
trusted-sweep, general auto-transition, and general auto-relocation options
must remain disabled.

```bash
pnpm mcp:farm-start -- \
  --zone-id 235 \
  --maximum-seconds 1800 \
  --maximum-fights 100 \
  --scan-radius 50 \
  --minimum-start-hp-percent 75 \
  --allow-caution true \
  --auto-relocate false \
  --auto-transition false \
  --target-level 0 \
  --quest-item-id 0 \
  --trusted-camp-sweep false \
  --auto-job-abilities true \
  --weapon-skill Combo \
  --combat-spell Blizzard \
  --maximum-combat-spells-per-fight 1 \
  --minimum-cast-mp-percent 35 \
  --nm-route true \
  --maximum-route-rounds 1 \
  --minimum-free-inventory-slots 5 \
  --confirmation 'ARM PRIVATE SERVER FARM SUPERVISOR'
```

Use `pnpm mcp:farm-status` for the compact lease/route state and
`pnpm mcp:farm-stop` for a cooperative stop that drains live combat.

## Completed implementation checkpoints

1. **Complete.** Move NM profiles out of the farm script into a validated data
   module.
2. **Complete.** Add a route policy that tracks camp, round, per-visit
   placeholder kills, watched rewards, respawn cooldowns, and completion
   reasons.
3. **Complete.** Extend the detached farm manager and `start/status/stop` MCP
   surface with the same lease ownership, confirmation, runtime permissions,
   and emergency disarm contract as the farm supervisor.
4. **Complete.** Unit-test exact-ID exclusion, NM-over-placeholder priority,
   multi-placeholder Sophie behavior, owned-item skipping, inventory pressure,
   route advancement, reactive-defense precedence, and time/round limits.
5. **Complete.** Validate every camp's local metadata/profile constraints and
   live-validate one bounded four-camp round before enabling repeated rounds.
