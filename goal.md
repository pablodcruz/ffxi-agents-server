# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 25 / Warrior 1, 2,037/5,300 EXP.
- Currency: 19,976 gil; 4,934 Sparks; 1,100 Unity accolades.
- Equipment verified through AgentBridge: Brass Baghnakhs, Trader's Chapeau,
  Trader's Saio, Trader's Cuffs, Trader's Slops, Trader's Pigaches, White
  Belt, and Bastokan Ring.
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
- Level-aware Monk ability automation is active: Dodge, Boost, and Focus are
  live-validated; Chakra unlocks at 35 and remains HP-gated. Emergency and
  risky situational abilities remain excluded.
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
- Trusted Valkurm sweep exclusions: worms, Stone Eaters, special mob types,
  Treasure Caskets, mobs above the level envelope, and vertically separated
  targets. The western South Gustaberg Quadav pocket remains globally
  excluded.
- Inventory is 18/30 after the quest-item turn-in. Equipped combat gear, Meat
  Jerky, and reviewed field drops remain carried; supplies are in the 30-slot
  Mog Sack and spare armor is in Mog Wardrobe 1. Mog Safe 2 is unlocked at
  0/50. Store the newly carried 11 Beastmen's Seals with Shami on the next
  Port Jeuno visit; 27 are already stored.

## Current Goal 1 — unlock support jobs

Status: **completed 2026-07-29**

1. Accept `Elder Memories` normally from Isacio in Selbina.
2. Acquire one Magicked Skull, one Damselfly Worm, and one Crab Apron through
   ordinary Valkurm combat, using Trusts and the bounded farm supervisor where
   its current policies fit.
3. Trade the exact quest items to Isacio in the server-required order:
   Magicked Skull, Damselfly Worm, then Crab Apron.
4. Verify the support-job unlock through live system evidence and the
   `char_jobs.unlocked` value changing from its baseline of 126.
5. Select one level-1 starter job as Pablo's support job through the normal Mog
   House job-change menu and verify both client and server state.
6. Document the pinned quest/drop behavior, automation decisions, and verified
   result; commit and push the completed workflow.

All six exit criteria are complete without administrative item grants or
quest/job-state edits. The three items were consumed in the pinned order,
Isacio emitted the unlock system message, the server unlock bit was verified
read-only, and the final client state is main job 2 level 25 with support job
1 level 1.

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
