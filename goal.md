# Active goal

Last reviewed: 2026-07-30

Build an agent-controlled FFXI character that can progress reliably on the
isolated LandSandBoat server. Deterministic local supervisors own fast combat
reactions; MCP/Codex owns goals, routing, menu work, recovery, and validation.

This file is intentionally short and current. Durable setup, experiments, and
resolved failures belong in `docs/`.

## Current state

- Pablo: Hume male, Monk 30 / Warrior 15, White Mage 19, and
  Black Mage 20 / White Mage 10, with Black Mage at 1,832/4,600 EXP and
  Bastok Rank 3.
  The final Emissary turn-in awarded the Adventurer's Certificate and
  Certified Adventurer title; a zone reload refreshed the client rank cache.
- Currency: 19,110 gil; current balances are 20,274 Sparks and
  1,100 Unity accolades.
- Current location: the validated Valkurm Sand Hare camp in zone 103. The
  detached Black Mage 40 lease is active as Black Mage 20 / White Mage 10
  with three Trusts, one Blizzard cast per registered fight, and automatic
  transition to Sauromugue at level 25.
- Current Black Mage equipment: Yew Wand, full Trader's armor, and Empress
  Band. The five armor pieces were reused from Mog Wardrobe 1; the exact Yew
  Wand cost 60 Sparks, was transferred to the wardrobe, and provides INT+3
  and MND+3. Inventory returned to 29/30 after the transfer.
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
- Optional combat-spell automation is live-validated. A lease may cast one
  configured spell per registered fight only after the target has taken
  damage, while Pablo and the exact selected target are engaged and MP is
  above the configured floor. Fire carried Black Mage through level 18;
  Blizzard was learned normally from its purchased scroll and carried the
  final level-18-to-20 lease.
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
- Inventory is 29/30 after the White Mage spell pass. The Empress Band
  remains in Inventory and Mog Safe 2 is unlocked at 0/50. Route inventory
  checks happen at camp boundaries, not after every fight.

## Current Goal 1 — Black Mage 40 / White Mage

Status: **active**

1. **Complete.** End the White Mage leveling lease at White Mage 19 and
   change to Black Mage 20 / White Mage 10 through the guarded normal job
   packets beside the verified Mog House Moogle.
2. **Complete for this leveling pass.** Build the useful White Mage spell
   set. Cure, Dia, Poisona, Protect, Paralyna, Blindna, and Curaga were
   purchased and learned normally from Sororo. Remaining low-level spells
   absent from Sororo's current conquest-dependent stock can be acquired at a
   later city checkpoint without blocking this level lease.
3. **In progress.** Start a detached level-aware Black Mage lease with White
   Mage support, one bounded combat spell per fight, Trust repair, death
   recovery, and level-appropriate camp transitions.
4. **Pending.** Upgrade the configured combat spell as stronger learned
   elemental tiers become usable without interrupting the melee/Trust loop.
5. **Pending.** Reach and independently verify Black Mage 40 with White Mage
   support, then stop the supervisor cleanly.

## Prior Goal — Black Mage 20

Status: **complete**

1. **Complete.** Change to Black Mage through the guarded normal Mog House
   job menu and retain Warrior as support job.
2. **Complete.** Clean Inventory, purchase Stone, Water, Aero, Fire, and
   Blizzard normally, then consume each scroll only at its usable level.
3. **Complete.** Add a bounded per-fight combat-spell policy and live-validate
   Fire and Blizzard without replacing Trust tanking or deterministic melee.
4. **Complete.** Reach Black Mage 20 through detached level-aware leases with
   exact target selection, guarded camp transitions, Trust repair, recovery,
   and zero deaths in the final lease.
5. **Complete.** Independently verify Black Mage 20 / Warrior 10 at
   153/4,600 EXP and publish one tested checkpoint.

## Current Goal — five-camp notorious-monster loop

Status: **complete**

1. **Complete.** Clean Inventory from 29/30 to 17/30 while preserving
   protected items.
2. **Complete.** Convert the live Leaping Lizzy experiment into a data-driven
   route over Leaping Lizzy, Stinging Sophie, Jaggedy-Eared Jack, Spiny Spipi,
   and Hoo Mjuu the Torrent.
3. **Complete.** At each camp, target only exact local placeholder/NM server
   IDs, prioritize an active NM, defend against actual aggro, and move on
   after one bounded placeholder pass instead of waiting through its respawn.
4. **Complete.** Skip completed camps when their watched unique item is already
   owned; stop on inventory pressure, death, session faults, route limits, or
   a hard safety condition.
5. **Complete.** Show route/round/camp progress in the local overlay and
   live-validate one complete five-camp round. The route visited all five
   camps, killed seven exact placeholders, handled five reactive adds, and
   stopped with zero deaths.
6. **Complete.** Add a guarded Bastok Markets safe exit after the last round;
   the live finding showed that merely disarming in Giddeus can leave a
   nearby aggressor hitting the unattended character.

See `docs/notorious-monster-loop.md` for the authoritative local IDs, drops,
controls, live results, and safety findings.

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
- Automated Black Mage 1→20 progression completed with normal spell
  purchases, guarded scroll use, Fire/Blizzard combat casting, deterministic
  level-band transitions, and zero deaths in the final lease.
- The first guarded five-camp NM loop completed in 8m40s with seven exact
  placeholder kills, five reactive defenses, zero deaths, a local route
  overlay, inventory guards, and a safe Bastok exit.
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
