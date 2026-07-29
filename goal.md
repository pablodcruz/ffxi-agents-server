# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Warrior 20 / Monk 10, 342/4,600 EXP, verified through live
  AgentBridge state after the detached supervisor stopped at its level target.
- Currency: 20,298 gil; 4,934 Sparks; 1,100 Unity accolades.
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
- Control: AgentBridge 0.27.0, exact-ID targeting, exact normal-client RoE
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
- Inventory is 30/30 after the Warrior run. Equipped combat gear, Meat
  Jerky, and reviewed field drops remain carried; supplies are in the 30-slot
  Mog Sack and spare armor is in Mog Wardrobe 1. Mog Safe 2 is unlocked at
  0/50. Store the newly carried 19 Beastmen's Seals with Shami on the next
  Port Jeuno visit; 27 are already stored.

## Current Goal 1 — Warrior level 20

Status: **completed 2026-07-29**

1. Select Warrior as the main job and Monk as the support job through the
   ordinary Mog House interface. **Complete.**
2. Equip level-appropriate starter gear and run the detached trusted-camp
   supervisor with Trust repair, broad vetted pulls, guarded relocation,
   weapon skills, and safe Warrior abilities.
3. Progress through South Gustaberg, Konschtat Highlands, and Valkurm Dunes as
   required by the validated level bands.
4. Verify Warrior level 20 from live client state, document material findings,
   run the test suite, then commit and push the completed checkpoint.

All four exit criteria are complete. The final clean Valkurm lease restored
three Trusts after death recovery, completed 24 fights for 4,670 EXP, used 10
weapon skills and four Berserks, performed no level-gap Trust refreshes, and
recorded no deaths. It stopped itself at Warrior 20 after draining reactive
combat; live state independently verified Warrior 20 / Monk 10 and the
completed goal overlay.

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
- `Elder Memories` completed through ordinary combat and exact-item trades.
  Spawn-slot-aware trusted sweeping acquired the final Magicked Skull, and the
  normal Mog House menu established Monk 25 / Warrior 1.
- Seal stacking/storage, loot selling, casket exclusion, travel caching, and
  exact-ID combat helpers validated.
- Unified farm supervisor implemented with proactive selection, reactive aggro
  defense, automatic Combo, recovery, and emergency disarm.

Update this file only when current state, priorities, blockers, or exit
criteria change.
