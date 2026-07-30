# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Thief 20 / Warrior 10, 1,207/4,600 EXP, verified through
  live AgentBridge state after the detached supervisor's target-level stop.
- Currency: 20,676 gil; 4,934 Sparks; 1,100 Unity accolades.
- Current Warrior equipment verified through AgentBridge: Hume Tunic, Hume M
  Gloves, Hume Slacks, Hume M Boots, and Bastokan Ring. Brass Baghnakhs,
  Trader's gear, and White Belt remain carried but are not Warrior-compatible.
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
  nearby mob whose exported maximum level is at most Pablo's level + 1,
  skips worms, prioritizes engaged adds, requires healthy Trust support, and
  stops on the watched item or a hard safety/lease condition. Per-pull
  `/check` is intentionally disabled in this already validated level band.
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
  leveling. This does not block the current level target, but loot collection
  is saturated. Empress Band remains equipped; Signet and Dedication were
  still active in the latest authoritative state. Mog Safe 2 is unlocked at
  0/50. Perform a reviewed storage/selling pass before the next drop-dependent
  objective; do not add routine inventory polling to combat.

## Current Goal 1 — Thief level 20

Status: **completed 2026-07-29**

The run incorporates the relevant level-1–20 recommendations from Andy Plays
Games' [fast endgame guide](https://youtu.be/LSaCcYg2Gis), without repeating
prerequisites Pablo already completed or adding per-fight friction:

1. **Complete.** Review active Records of Eminence slots and add only passive
   objectives matching the farm loop: broad combat, damage, weapon skills, and
   likely crystal spoils. The existing passive objectives already cover the
   combat loop. Complete the normal Bastok tutorial path before EXP: Signet is
   active, the Conquest promotion voucher was exchanged normally for an
   Empress Band, and its Dedication effect was verified before this lease.
2. **Complete.** Near the Mog House Moogle, select Thief as main job and
   Warrior as support job using the guarded normal-client job-change
   operation, and free inventory space. The live client verified THF 1 / WAR 1.
   Per operator direction, retain hand-to-hand and skip gear purchasing during
   this short Trust-supported run.
3. **Complete.** Detached recovery lease
   `e4216c92-00b5-48ee-a33c-5bb91de11cee` owns the final Thief 19→20 segment
   at the original metadata-vetted Valkurm Sand Hare cluster. The prior lease
   automatically transitioned from exhausted Konschtat targets at level 18
   and reached Thief 19 at 3,657/4,400. A later broad camp relocation entered
   a Goblin pocket; a reactive Goblin Leecher defeated Pablo, and the
   supervisor returned him to Bastok Markets and stopped cleanly. Recovery
   used one authoritative state check, one guarded combat-free teleport, and
   this new fixed-camp lease. Auto-relocation is disabled for the short final
   segment, the next-pull HP threshold is conservatively 90%, and reactive
   defense, Trust repair, abilities, automatic level-band transitions, and the
   target-level stop remained active. It rebuilt all three Trusts, defeated two
   Hares for 1,950 counted EXP, reached Thief 20 at 1,207/4,600, and stopped
   itself after 108 seconds with zero deaths, reactive engagements, rejected
   attacks, target-cycle errors, or unsafe-action counters.
   Routine progress, EXP-rate, inventory, and Trust polling were omitted.
   Ignored local lease state/logs provided routine telemetry, with a single
   live MCP call reserved for the supervisor's level-20 stop.
   Living Trusts are not refreshed on every level. The first Konschtat lease
   exposed `Rock Eater` as another worm-family name; both combat admission and
   relocation now exclude it, with focused policy tests. Guarded
   private-server teleports remain available for recovery; travel-node
   registration is out of scope.
4. **Complete.** Add only low-friction Thief automation. Do not automate Steal into a full
   inventory, Perfect Dodge remains emergency-only, and Sneak Attack requires
   trustworthy behind-target geometry before routine use. Therefore THF
   levels 1–20 intentionally have no routine automated job ability.
5. **Complete.** Live state independently verified Thief 20 / Warrior 10,
   1,207/4,600 EXP, the completed goal overlay, closed menus, and a stable
   logged-in client. The full suite passes 97/97; document, commit, and push
   this completed checkpoint.

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
