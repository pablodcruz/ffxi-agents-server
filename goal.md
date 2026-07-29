# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 17, 229/4,000 EXP.
- Currency: 28,815 gil; 2,285 Sparks; 1,000 Unity accolades.
- Equipment verified through AgentBridge: Brass Baghnakhs, Headgear, Doublet,
  Gloves, Brais, Gaiters, White Belt, and Bastokan Ring.
- Gil milestone completed: 28,815/10,000 through normal Sparks conversion.
- Trusts learned: Naji, Valaineral, Mihli Aliapoh, Tenzen, Adelheid, Joachim.
- Adelheid and Joachim were each summoned successfully through MCP.
- Tutorial Trust RoE completed through Joachim. Exact objective 937 awarded
  500 EXP and a first-time bonus of 300 Sparks.
- Exactly eleven non-hidden RoE records are complete. `All for One` (record 5)
  completed normally for 300 EXP, 300 Sparks, and 1,000 Unity accolades.
- Pablo joined Apururu's Unity through Igsli's normal client dialogue. The
  server stores Unity leader ID 4 and Pablo received the Concordoll key item.
- The pinned LandSandBoat Unity handler does not grant Apururu (UC) spell 955;
  `/ma "Apururu (UC)" <me>` correctly fails because Pablo's `char_spells`
  record lacks 955. Mihli Aliapoh remains the healer until that server gap is
  fixed normally.
- Control: AgentBridge 0.25.0, exact-ID targeting, exact normal-client RoE
  activation, guarded private-server
  travel, automatic Combo, local-only activity feed, and bounded farm
  supervisor.
- Safe baseline camp: Konschtat Highlands zone 108 near
  `(-326.295, -51.917)`, using Mad Sheep and Strolling Saplings.
- Level-15 camp: Konschtat Highlands zone 108 near
  `(-40.803, 436.784, 40.0)`, with two level 13–14 Mad Sheep and the nearest
  aggressive spawn about 46 yalms away.
- The farm supervisor can rotate among same-zone metadata-vetted Mad Sheep
  clusters after five seconds without an approved target. It requires the
  current level band, a 40-yalm aggressive-spawn buffer, and a combat-free
  state before each guarded relocation.
- A level-aware lease can repair the Valaineral/Joachim/Mihli party while idle
  and, at Monk 18, transition from exhausted Konschtat sheep to a
  metadata-vetted Valkurm Sand Hare cluster. Cross-zone control remains
  combat-free and exact-check gated.
- Registered travel: Metalworks Home Point #2 and Bastok Markets Home Point
  #3. Guarded private-server teleport remains the default fallback until
  collision-aware navigation meets its reliability target.
- Farming exclusions: worms, Stone Eaters, Huge Hornets, Vultures, Treasure
  Caskets, and the western South Gustaberg Quadav pocket.
- Inventory remains auto-sorted. Store future Beastmen's Seal batches with
  Shami in Port Jeuno; Pablo currently has 14 stored and 5 carried.

## Current Goal 1 — finish the Trust/Unity progression checkpoint

Status: **completed**

1. Exact RoE activation: **completed and live-validated** through FFXI's normal
   `0x10C` packet.
2. `Alter Ego: Joachim`: **completed**, awarding 500 EXP and 300 Sparks.
3. Unique non-hidden RoE count: **11**, so no filler records were required.
4. `All for One`: **completed**. Apururu was explicitly named before the final
   confirmation; Igsli's event then awarded the Concordoll, 300 EXP, 300
   Sparks, and 1,000 Unity accolades. Database validation confirmed
   `unity_leader = 4`.

Do not block combat validation on step 1: the balanced Trust roster itself is
already learned and usable.

## Current Goal 2 — reach Monk level 20 through local automation

Status: **active; 15 → 20**

1. Keep Valaineral, Joachim, and Mihli Aliapoh as the automated party until the
   pinned server's missing Apururu (UC) spell grant is resolved.
2. Let deterministic local supervisors own target selection, exact checks,
   approach, battle, weapon skills, recovery, and safe camp rotation. MCP
   should start bounded leases, inspect milestones, and handle exceptions.
3. Progress through metadata-vetted camps without weakening the current
   rejection of high evasion, `even match`, `tough`, or harder targets.
4. Automate Trust readiness and same-zone camp rotation before adding
   cross-zone level-band transitions.
5. Check inventory only at lease boundaries, near capacity, or before selling
   and seal-storage runs.

Latest completed bounded result: lease
`21e6d893-2482-403d-a3e3-320d5b42be5e` defeated five Mad Sheep for 780 EXP
in 214 seconds with Valaineral, Mihli Aliapoh, and Joachim. It autonomously
rotated among three metadata-vetted camps and fired Combo once. Pablo remained
safe and reached 1,139/3,600 EXP at level 15. One moving spawn produced a
bounded visibility rejection and target-cycle cooldown; the supervisor
continued normally. There were zero deaths, recoveries, combat teleports, or
recovery actions during combat.

Lease `206e3488-a072-414e-907b-6b8f323417a6` then completed 15/15 fights for
2,350 EXP in 550 seconds, with 13 autonomous camp rotations, five Combos, no
deaths, no recoveries, and no combat teleport or recovery action. Pablo reached
3,489/3,600 EXP at level 15.

Lease `8f22d4da-40c8-44ff-afa3-337df3d4e11f` completed 15/15 fights for
2,340 EXP in 480 seconds, including two reactive handoffs. It fired Combo four
times, rotated camps fourteen times, and ended with zero deaths, recoveries,
combat teleports, or recovery actions during combat. Pablo reached Monk 16 at
2,229/3,800 EXP, and the final local overlay matched authoritative state.

Current lease `a5f909a9-f631-468e-b025-2420aec9ecb2` is bounded to 30 fights or
30 minutes and enables local Trust repair, same-zone rotation, the level-18
Valkurm transition, exact-check combat, overlay refresh, and the level-20 stop.
It reached Monk 17 on fight 12 with four automatic Combos, two safe idle
recoveries, no deaths, and no combat teleport or recovery action. MCP
supervision remains milestone- and exception-based rather than fight-by-fight.

Valkurm lease `bfaffa06-dcaa-4620-af6a-b7f75e2621db` proved the next-tier
guard: three metadata candidates each checked `tough` and were excluded
without attack. The isolated level 15–16 hare checked `even match` and was
also excluded. Revisit Sand Hares at level 16; do not weaken the exact-check
policy.

Safety rules:

- Never teleport while attacked or engaged.
- Stop on logout, zoning, death, expired lease, or emergency stop.
- Reject high-evasion and even-match-or-harder proactive targets.
- Permit a clean `decent challenge` only when live Trust telemetry satisfies
  the tested policy.
- Never proactively select excluded families or caskets.

Exit criteria:

- Pablo reaches Monk level 20 through normal combat rewards.
- 30 consecutive approved fights without a preventable aggro death.
- Three controlled multi-enemy wins with correct target handoff.
- Aggro-to-attack latency consistently below one second.
- Automatic weapon-skill use and safe post-fight recovery observed live.

## Current Goal 3 — improve deterministic menus and travel

Status: **queued alongside combat**

- Expose a verified menu cursor/index or exact RoE objective selector through
  the local bridge; stop encoding long menu paths as remembered offsets.
- Register nearby Home Points, Survival Guides, Waypoints, and outposts, then
  cache exact IDs and coordinates.
- Prefer registered travel when reliable; use guarded local-server teleport as
  the recovery/default path until collision-aware navigation is proven.
- Keep credential files ignored and local. Never commit login values.

## Completed milestones

- Local LandSandBoat server, Windows ARM VM, official FFXI client, Ashita, and
  AgentBridge/MCP control plane deployed and documented.
- Public repository, tests, stream overlays, OBS workflow, and troubleshooting
  runbooks established.
- 10,000-gil target exceeded through normal gameplay.
- Level-11 Sparks equipment set bought and equipped.
- Seal stacking/storage, loot selling, casket exclusion, travel caching, and
  exact-ID combat helpers validated.
- Unified farm supervisor implemented with proactive selection, reactive aggro
  defense, automatic Combo, recovery, and emergency disarm.

Update this file only when current state, priorities, blockers, or exit
criteria change.
