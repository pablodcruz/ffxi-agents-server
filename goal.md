# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 30 / Warrior 15, 77/5,800 EXP. The live
  authoritative state independently verified the target after the detached
  Sauromugue run stopped itself.
- Currency: 20,713 gil; 4,934 Sparks; 1,100 Unity accolades.
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
- Inventory was reduced before the Thief run but is now 30/30 after unattended
  leveling. This did not block the level target, but loot collection is
  saturated. Signet remains active; Dedication is no longer present in the
  final authoritative state, and the Empress Band remains in Inventory. Mog
  Safe 2 is unlocked at 0/50. Perform a reviewed storage/selling pass before
  the next drop-dependent objective; do not add routine inventory polling to
  combat.

## Current Goal 1 — Monk level 30

Status: **complete**

1. **Complete.** Dismiss Trusts, enter the Bastok Mog House, and use the
   guarded normal-client job operation to establish Monk main / Warrior
   support. Live state verified MNK 25 / WAR 12. An instantaneous placement at
   the zoneline was rejected; the reliable path is to place on the valid
   corridor side at `(-148.8, -30.329)`, then make one bounded ordinary
   movement through the trigger.
2. **Complete.** Equip the best compatible owned set. Brass Baghnakhs, Trader's
   Chapeau, Trader's Saio, Trader's Cuffs, Trader's Slops, Trader's Pigaches,
   White Belt, and Bastokan Ring are equipped. No purchase is required before
   level 30.
3. **Complete.** Validate the level-25 Sauromugue camp. Metadata selected two
   level-25–26 Hill Lizards around `(-88.428, -88.830)` with the nearest
   aggressive spawn 53 yalms away. Calibration lease
   `95b2efd6-a39a-434c-84a3-d1acbea0121a` defeated both for 690 EXP, used two
   Combos and eight Monk abilities, and recorded zero deaths, rejected
   attacks, target-cycle errors, combat teleports, or combat recoveries.
4. **Complete.** Detached lease `9ce4385a-b897-49fc-bd02-b528e535d0db`
   ran for its full one-hour safety bound, completed 59 fights, and stopped
   cleanly at MNK 29 with zero deaths. It recorded 48 proactive engagements,
   12 reactive engagements, 12 linked handoffs, 49 Combos, 178 Monk
   abilities, and no combat teleports or recoveries. Automatic selection moved
   from Bat/Lizard targets to Diving Beetles at level 27.
5. **Complete.** Renewal lease `f095c095-2030-4a8d-be4a-357a1beaab15`
   completed four fights and stopped itself on `target_level` at MNK 30. It
   recorded 2,180 supervisor-counted EXP, five Combos, eleven Monk abilities,
   one reactive handoff, and zero deaths. One final authoritative state call
   verified MNK 30 / WAR 15 at 77/5,800 with the complete owned gear set still
   equipped.

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

Update this file only when current state, priorities, blockers, or exit
criteria change.
