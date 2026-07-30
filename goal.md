# Active goal

Last reviewed: 2026-07-30

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 30 / Warrior 15, 1,917/5,800 EXP, Bastok Rank 3.
  The final Emissary turn-in awarded the Adventurer's Certificate and
  Certified Adventurer title; a zone reload refreshed the client rank cache.
- Currency: 27,171 gil; 4,934 Sparks; 1,100 Unity accolades.
- Current Monk equipment verified through AgentBridge: Brass Baghnakhs, full
  Trader's armor, White Belt, and Bastokan Ring. The job change restored this
  owned set automatically from Inventory and Mog Wardrobe 1.
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
- Control: AgentBridge 0.28.0, guarded normal-client main/support job changes
  near a Moogle, exact-ID targeting, exact normal-client RoE
  activation and container transfers, guarded private-server travel, automatic
  Combo, local-only activity feed, and bounded farm supervisor.
- `Elder Memories` is complete. The client reported that support jobs can now
  be designated, the server's `char_jobs.unlocked` value changed from 126 to
  127, and Warrior 1 was selected normally through the Mog House job menu.
- Durable trusted-camp sweep is validated in Valkurm. Combat and drop detection
  run independently of Codex/MCP analysis calls: it attacks every ordinary
  non-aggressive nearby mob whose exported maximum level is at most Pablo's
  level + 1, skips worms, prioritizes engaged adds, requires healthy Trust
  support, and stops on the watched item or a hard safety/lease condition.
  Aggressive mobs are not proactive pulls but remain immediate reactive
  targets if they engage Pablo or a Trust. Per-pull `/check` is intentionally
  disabled in an already validated level band.
- Level-aware job ability automation is active. Monk's Dodge, Boost, and Focus
  are live-validated; Chakra unlocks at 35 and remains HP-gated. Warrior uses
  Berserk from level 15, emergency-only Defender from 25, party-wide Warcry
  from 35, and Aggressor from 45. Provoke is intentionally excluded from
  routine farming so Pablo does not pull hate from the Trust tank.
- Safe baseline camp: Konschtat Highlands zone 108 near
  `(-326.295, -51.917)`, using Mad Sheep and Strolling Saplings.
- Level-15 camp: Konschtat Highlands zone 108 near
  `(-40.803, 436.784, 40.0)`, with two level 13–14 Mad Sheep and the nearest
  aggressive spawn about 46 yalms away.
- The farm supervisor can rotate among same-zone metadata-vetted Mad Sheep
  clusters after five seconds without an approved target. It requires the
  current level band, a 40-yalm aggressive-spawn buffer, and a combat-free
  state before each guarded relocation.
- A level-aware lease treats Valaineral/Joachim/Mihli availability as a combat
  invariant and repairs only a missing, defeated, or zone-dismissed Trust.
  It deliberately does not refresh living Trusts merely because Pablo levels;
  avoiding those dismiss/recast cycles keeps combat continuous. At level 17
  it transitions from exhausted Konschtat sheep to a metadata-vetted Valkurm
  Sand Hare cluster. Cross-zone control remains combat-free and exact-check
  gated.
- Validated level-band transitions take priority while idle once their level
  threshold is reached; they no longer wait for a broad sweep to exhaust every
  respawning lower-level target.
- Valkurm rotation explicitly admits level-17 Sand Hare metadata as camp
  candidates, but the live `/check` result remains authoritative. A live
  `even match` Hare was excluded before attack while `decent challenge` Hares
  continued normally.
- Registered travel: Metalworks Home Point #2 and Bastok Markets Home Point
  #3. Guarded private-server teleport remains the default fallback until
  collision-aware navigation meets its reliability target.
- Trusted Valkurm sweep exclusions: worms, Stone Eaters, special mob types,
  Treasure Caskets, mobs above the level envelope, and vertically separated
  targets. The western South Gustaberg Quadav pocket remains globally
  excluded.
- Inventory is 22/30 after the Rank 3 run. The Empress Band remains in
  Inventory and Mog Safe 2 is unlocked at 0/50. Perform a reviewed
  storage/selling pass before the next long drop-dependent objective; do not
  add routine inventory polling to combat.

## Current Goal 1 — Bastok Rank 3

Status: **complete**

1. **Complete.** Finish Bastok missions 1-1 `The Zeruhn Report` and 1-2
   `A Geological Survey` through their normal NPC interactions.
2. **Complete.** Finish 1-3 `Fetichism` with an exact-drop Palborough Mines
   sweep and one normal four-item trade to a mission guard.
3. **Complete.** Finish `The Crystal Line` and `Wading Beasts` through their
   normal crystal, key-item, and item-trade interactions.
4. **Complete.** Finish `The Emissary` through the San d'Oria-first route,
   Warchief Vatgit, Windurst, and the Balga's Dais Rank 2 dragon battlefield.
5. **Complete.** Verify live Bastok Rank 3, rank points 0, 27,171 gil, and the
   Certified Adventurer title after one zone reload. Record the reusable
   mission/menu findings, run focused tests, and publish one checkpoint.

Do not sell food, seals, equipment, quest items, or unreviewed drops. Keep all
credentials ignored and local.

## Completed milestones

- Local LandSandBoat server, Windows ARM VM, official FFXI client, Ashita, and
  AgentBridge/MCP control plane deployed and documented.
- Public repository, tests, stream overlays, OBS workflow, and troubleshooting
  runbooks established.
- 10,000-gil target exceeded through normal gameplay.
- Level-11 Sparks equipment set bought and equipped.
- Level-20 Trader's armor set bought and equipped after a guarded inventory
  cleanup and seal-storage run.
- Mog Sack purchased, all three starter-city Mog House exit quests completed,
  Mog Safe 2 unlocked, and carried inventory reduced from 23/30 to 9/30
  without administrative item grants.
- Trust/Unity progression completed, including Joachim, `All for One`,
  Apururu's Unity membership, Concordoll, and 1,000 Unity accolades.
- Automated Monk 15→20 progression completed with exact-check combat, guarded
  camp rotation, Trust repair, reactive handoff, automatic Combo, and zero
  deaths in the final lease.
- Automated Thief 1→20 progression completed with Signet, Dedication, guarded
  normal-packet job selection, local-only progress monitoring, deterministic
  level-band transition, death recovery, and a clean two-fight final lease.
- `Elder Memories` completed through ordinary combat and exact-item trades.
  Spawn-slot-aware trusted sweeping acquired the final Magicked Skull, and the
  normal Mog House menu established Monk 25 / Warrior 1.
- Seal stacking/storage, loot selling, casket exclusion, travel caching, and
  exact-ID combat helpers validated.
- Unified farm supervisor implemented with proactive selection, reactive aggro
  defense, automatic Combo, recovery, and emergency disarm.
- Bastok Rank 1 through Rank 3 completed through normal mission and NPC
  progression, with guarded private-server travel and bounded exact-ID combat.

Update this file only when current state, priorities, blockers, or exit
criteria change.
