# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 20, 389/4,600 EXP.
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
  and, at Monk 17, transition from exhausted Konschtat sheep to a
  metadata-vetted Valkurm Sand Hare cluster. Cross-zone control remains
  combat-free and exact-check gated.
- Valkurm rotation explicitly admits level-17 Sand Hare metadata as camp
  candidates, but the live `/check` result remains authoritative. A live
  `even match` Hare was excluded before attack while `decent challenge` Hares
  continued normally.
- Registered travel: Metalworks Home Point #2 and Bastok Markets Home Point
  #3. Guarded private-server teleport remains the default fallback until
  collision-aware navigation meets its reliability target.
- Farming exclusions: worms, Stone Eaters, Huge Hornets, Vultures, Treasure
  Caskets, and the western South Gustaberg Quadav pocket.
- Inventory remains auto-sorted at 23/30 slots. Store future Beastmen's Seal
  batches with Shami in Port Jeuno; Pablo currently has 14 stored and 13
  carried.

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

Status: **completed; 15 → 20**

1. Keep Valaineral, Joachim, and Mihli Aliapoh as the automated party until the
   pinned server's missing Apururu (UC) spell grant is resolved.
2. Let deterministic local supervisors own target selection, exact checks,
   approach, battle, weapon skills, recovery, and safe camp rotation. MCP
   should start bounded leases, inspect milestones, and handle exceptions.
3. Progress through metadata-vetted camps without weakening the current
   rejection of high evasion, `even match`, `tough`, or harder targets.
4. Trust readiness, same-zone rotation, and the level-17 Konschtat-to-Valkurm
   transition are automated and live-validated.
5. Check inventory only at lease boundaries, near capacity, or before selling
   and seal-storage runs.

Latest completed calibration: Valkurm lease
`75682b7c-9770-47d8-9be2-0bb0ce7d19e8` completed 5/5 Sand Hare fights for
880 EXP in 267 seconds. It performed four guarded camp relocations, fired
Combo once, and rejected one live `even match` Hare before attack. All approved
targets checked `decent challenge` with Valaineral, Joachim, and Mihli Aliapoh
present. There were zero deaths, attack rejections, target-cycle errors,
combat teleports, or recovery actions during combat.

Final lease `14cb9905-796a-4a99-971e-fc053146539d` completed the milestone in
17 fights and 1,003 seconds. It earned 7,750 EXP, rotated among 16 vetted
camps, fired Combo seven times, and safely drained one aggroed Brutal Sheep
through a reactive handoff. A 5,000-EXP reward after fight 15 advanced Pablo
to level 19 at the one-point cap; the reactive Sheep then advanced him to
level 20. There were zero deaths, target-cycle errors, combat teleports, or
recovery actions during combat. The supervisor refreshed the in-game overlay
and stopped itself with `target_level`.

Safety rules:

- Never teleport while attacked or engaged.
- Stop on logout, zoning, death, expired lease, or emergency stop.
- Reject high-evasion and even-match-or-harder proactive targets.
- Permit a clean `decent challenge` only when live Trust telemetry satisfies
  the tested policy.
- Never proactively select excluded families or caskets.

Milestone exit criteria:

- Pablo reached Monk level 20 through normal combat rewards.
- Authoritative AgentBridge state reports Monk 20 at 389/4,600 EXP, 100% HP,
  idle, with all three intended Trusts healthy.
- The supervisor stopped on `target_level` with zero deaths or unsafe-action
  counters.

Further combat hardening remains queued: accumulate another 30-fight clean
sample, validate more multi-enemy handoffs, and measure immediate aggro
response separately from intentional add-drain timing.

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
