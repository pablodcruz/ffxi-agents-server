# Active goal

Last reviewed: 2026-07-29

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 20, 389/4,600 EXP.
- Currency: 19,574 gil; 4,934 Sparks; 1,100 Unity accolades.
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
- Inventory is reorganized at 9/30 slots: equipped combat gear and Meat Jerky
  remain carried, supplies are in the 30-slot Mog Sack, and nine spare armor
  pieces are in Mog Wardrobe 1. Mog Safe 2 is unlocked at 0/50. Store future
  Beastmen's Seal batches with Shami in Port Jeuno; Pablo currently has 27
  stored and none carried.

## Current Goal 1 — expand usable inventory

Status: **completed 2026-07-29**

1. Buy a 30-slot Mog Sack from an Artisan Moogle for exactly 9,980 gil.
2. Buy Amaryllis, Marguerite, and Lilac from Areebah in Upper Jeuno.
3. Complete `A Lady's Heart`, `Growing Flowers`, and `Flower Child` through
   exact-item trades to their intended NPCs.
4. Enter Pablo's Bastok Mog House and verify the second floor and Mog Safe 2
   unlock normally.
5. Move equipment to a Mog Wardrobe and supplies to the Case or Sack while
   preserving field-use food and all protected items.
6. Assess normal sources for the four Gobbiebag Part I materials without
   administrative item grants or an uneconomical 150,000-gil stew purchase.
7. Verify capacities, inventory, gil, quest state, and protected items before
   declaring the goal complete.

All seven exit criteria are complete. The live map server accepted an exact
Sack-to-Safe-2 item transfer and its reversal after the unlock cutscene,
authoritatively proving runtime access to the 50-slot container. The online
`chars.moghouse` database value had not yet flushed; verify it after a normal
logout before treating that field as persistence evidence.

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
- Seal stacking/storage, loot selling, casket exclusion, travel caching, and
  exact-ID combat helpers validated.
- Unified farm supervisor implemented with proactive selection, reactive aggro
  defense, automatic Combo, recovery, and emergency disarm.

Update this file only when current state, priorities, blockers, or exit
criteria change.
