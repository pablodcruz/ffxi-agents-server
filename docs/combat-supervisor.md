# Reactive combat supervisor

## Why this layer exists

An LLM/MCP control loop is appropriate for goals, policy changes, route selection,
and diagnosing exceptions. It is not the right real-time layer for noticing one
incoming hit and issuing `/attack` before several more hits land.

The first bounded supervisor was `scripts/mcp-aggro-guard.mjs`. The current
implementation is `scripts/mcp-farm-supervisor.mjs`: one local process owns
proactive targeting, reactive defense, approach, battle, weapon skills,
recovery, and stop conditions. It keeps one MCP connection open and acts
without per-fight model calls or model tokens.

For low-call operation, start one target-level lease and treat its ignored
`runtime/farm-supervisor/primary.json` plus lease JSONL log as the routine
telemetry. Do not poll live MCP state, inventory, Trusts, or EXP rate between
fights. The supervisor refreshes the local in-game goal overlay, repairs
defeated or zone-dismissed Trusts, applies configured level-band transitions,
and stops at the target level. Use one authoritative live-state call after a
hard safety event or after the target-level stop.

## Research basis

[EasyFarm](https://github.com/EasyFarm/EasyFarm) used a finite-state design with
separate targeting, pulling, approach, battle, weapon-skill, healing, trust,
travel, and death states. Its useful lesson is the decomposition, not its
runtime: the repository was archived in 2024 and depends on the older EliteMMO
memory API.

[Ashita v4's example addon](https://github.com/AshitaXI/example) demonstrates
incoming packet and text events plus coroutine work. That makes a future
client-side event detector possible. The first version stays host-side because
our existing AgentBridge observations, guarded writes, audit trail, and tests
already live there.

[Pathfinder](https://github.com/xathei/Pathfinder) remains relevant to
navigation. It exposes navmesh path and wall-edge operations, but it does not
replace combat-state handling.

## Current safety contract

The guard:

- requires an exact zone ID and an explicit private-solo confirmation;
- expires after a bounded duration or engagement count;
- considers only live entities already in fighting status;
- excludes Pablo and every active party member;
- preserves the exact current engaged target, then chooses the nearest add;
- bypasses `/check` only for reactive defense;
- targets by exact server ID, attacks, and uses a configured weapon skill at
  1000 TP;
- re-arms its own guarded control lease before reactive writes so a separate
  high-level MCP action can still finish with its normal emergency stop;
- treats the configured fight count as a proactive limit, drains any active
  defensive threat, and returns to the lease's starting camp while idle before
  stopping;
- treats an explicit cooperative stop as a drain request: it starts no new
  proactive pull, finishes tracked and reactive combat, and requires eight
  fresh idle samples before disabling control;
- requires safe checks by default. A lease may explicitly admit only
  `decent challenge` targets without high-defense or high-evasion evidence;
  even match and every harder result remain forbidden;
- stops on logout, zoning, death, signal, or lease expiration;
- performs an emergency stop when it exits.

The private-solo confirmation is important. Entity fighting status alone cannot
distinguish aggro from a link or another player's claimed target. Before this is
safe on a shared public server, AgentBridge must expose claim/target ownership or
derive it from incoming action packets.

## Live validation

On 2026-07-28, Pablo (MNK 10) and Naji were placed near an isolated level 3–4
Young Quadav in South Gustaberg. The mob initiated combat. The guard selected
exact server ID `17215677` at 2.66 yalms and issued the defensive attack without
an LLM decision or `/check`. Naji defeated it, Pablo remained at 97% HP, and the
server awarded 80 EXP and 6 gil. The guard then returned to idle and stopped at
its two-minute lease boundary.

The unified supervisor was validated live later on 2026-07-28:

- A pre-aggroed Young Quadav was attacked in 551 ms, defeated, and yielded
  80 EXP and 6 gil. Combo fired twice, and recovery began only after the kill.
- A clean fight-limited lease defeated two Walking Saplings and one Rock
  Lizard in 69 seconds with zero attack rejections, target-cycle errors,
  deaths, excluded pulls, combat teleports, or combat recovery actions.
- Exact target-follow approach closed the three proactive fights to 0.61,
  0.92, and 1.12 yalms before attack.
- The clean lease counted 160 EXP; the Rock Lizard was too weak to award EXP.
- A separate recovery test restored Pablo from 38% to above 90% while idle.
- The reliability sequence reached 30 consecutive approved unattended wins
  without a preventable death. Pablo reached Monk level 12.
- Two controlled add handoffs were won without disengaging. One queued Rock
  Lizard exposed a metrics issue: its 27-second wait was the intentional time
  spent finishing the first target, not aggro-response latency. The supervisor
  now records add queue time separately.
- An Amber Quadav later aggroed while FFXI already had it selected. The
  supervisor logged `reactive_target_preserved`, issued attack in 206 ms,
  followed from 7.83 to 0.84 yalms, and won.
- A third controlled handoff was won against a flat-terrain linked Walking
  Sapling pair. The two-fight lease finished in 36 seconds with one proactive
  and one reactive engagement, no rejected attack or unsafe action, and an
  exact return to its starting camp.
- A linked-lizard fixture exposed a target-follow race: the first reactive
  `/attack` could register while follow was closing distance, and an
  unconditional second `/attack` then toggled combat off. The supervisor now
  samples the fresh player/target stance and skips that second command when
  combat is already registered.
- The same fixture produced a real defeat after FFXI repeatedly reported that
  Pablo could not see a lizard only 1.07 yalms away. The supervisor detected
  status 3 and 0% HP, advanced only the exact observed `menu    dead` and
  `menu    comyn` states, moved once from the default **No** to **Yes**, returned
  to registered Bastok Markets, verified 100% HP, and stopped with
  `player_defeated_home_point`.
- Fresh in-combat `cannot see` events now trigger at most three bounded
  world-coordinate nudges through the exact nearby engaged target. This never
  teleports during combat. Weapon skills also wait until the target has taken
  damage, preventing repeated Combo attempts against an unregistered
  line-of-sight fixture.

Live failures also changed the policy:

- Vultures remain proactively excluded. Multiple exact IDs failed attack
  registration after coarse positioning, facing experiments, and target-follow
  approaches as close as 1.13 yalms.
- Explicit heading hold was removed because it interfered with the game's own
  combat facing.
- An aggro-selected exact target is preserved instead of cleared and
  reselected.
- Treasure Caskets are not farming objectives. Known casket/inline prompts and
  the accidental player menu are canceled so the combat loop can continue;
  caskets remain reserved for explicit quests or known valuable rewards.
- The game-command `/follow <t>` is tried first; if a hostile target does not
  move, a three-second AgentBridge `move_to_entity` lease runs directly toward
  it.
- FFXI reward messages are parsed despite trailing control bytes, and every
  lease baselines the existing event tail before counting rewards.
- A level-up can restore HP while the initial `/heal` command is still queued.
  Unconditionally sending another `/heal` may then put the character into
  healing stance after recovery appears complete. The supervisor now samples
  the live stance, sends the stand toggle only for status 33, and requires two
  fresh idle samples before it resumes positioning. A one-fight lease validated
  the repair.
- The high-elevation pocket near `(-380, -312)` remains diagnostic-only because
  direct target approach moved away from one Sapling. Avoid it in the clean
  baseline until collision-aware movement explains that behavior.
- A fight-limited lease once stopped beside aggressive Quadavs, and an Amber
  Quadav attacked afterward. The supervisor now checks for a live threat before
  honoring the numeric fight limit and returns to the lease origin while idle.
  Lease `c9713602-84a4-4383-9639-59affe30b6d3` validated the new path: one
  Sapling was defeated, Pablo returned exactly to the safe-camp origin, no live
  combat remained, and guarded control was then disabled.
- A disposable-menu race appeared after the gil milestone. The supervisor
  observed a known casket/player menu, but it closed before the queued cancel
  reached AgentBridge. The bridge correctly rejected a cancel with no open
  menu; the old supervisor treated that safe race as fatal. The loop now
  refreshes character menu state immediately before canceling and treats only
  the bridge's exact closed-menu rejection as a no-op. The focused follow-up
  lease `bb7454ae-69e7-4237-826f-d023e93db92d` defeated a Rock Lizard for
  90 EXP and stopped at its one-fight limit with no error or unsafe counter.
- That same pass live-triggered the bounded line-of-sight nudge against a
  Sapling. The recovery remained non-teleporting and safe, but two moving
  Sapling spawns still produced repeated visibility/registration failures.
  They are inefficient targets; the nearby Rock Lizard remained clean.
- An explicit stop once arrived just as a queued attack registered. The old
  loop immediately disabled control even though the fight continued. Lease
  `3ade4102-83d2-437d-9b79-5a67b07b7e57` live-validated the repaired drain:
  the stop latched during a tracked Sapling fight, the supervisor finished the
  kill, observed eight consecutive idle samples, and disabled control after
  9.447 seconds. A fresh observation showed Pablo idle and no late attack.
- South Gustaberg stopped awarding EXP at Monk level 14. Local LandSandBoat
  metadata selected a Konschtat Highlands camp near
  `(-326.295, -51.917)`: two live level 12–13 Mad Sheep were inside 13 yalms,
  and the nearest aggressive spawn was about 45 yalms away. `Mad Sheep` is the
  only newly admitted linked family. A safe-only lease observed and refused
  `decent challenge`; the explicit caution opt-in is unit-tested.
- A post-relogin exact-ID calibration established the current high-defense
  boundary. AgentBridge first verified Naji in party, then Pablo defeated one
  `decent challenge` Mad Sheep in a single attack attempt. Pablo remained at
  91% HP while Naji tanked, and the fight awarded 180 EXP.
- The first three-Trust run exposed a brittle admission rule: it recognized
  only the literal name `Naji`, so twelve otherwise valid Mad Sheep checks were
  excluded despite healthy Valaineral, Mihli Aliapoh, and Joachim telemetry.
  The rule now requires at least two healthy non-player party members in the
  current zone instead of one named Trust. Lease
  `43e936f2-c80a-4eb0-a87c-f2590f96565d` live-validated the repair with two
  high-defense `decent challenge` wins, 320 EXP, Pablo at 90% HP, and no
  deaths, attack rejections, exclusions, target-cycle errors, combat teleports,
  or combat recoveries. It stopped normally at four minutes after nearby
  spawns were exhausted. High evasion and even-match-or-harder checks remain
  excluded.
- Pablo reached Monk 15 through two additional clean Mad Sheep wins. At the
  original camp, the lower and upper sheep shelves differ by more than the
  four-yalm elevation gate. A cooperative stop followed by a guarded
  same-zone service teleport to the upper shelf avoided collision-prone
  roaming and produced the level-up normally.
- Valkurm metadata identified three nearby level 16–17 Sand Hares with the
  nearest aggressive goblin about 44.7 yalms away. `Sand Hare` is now an exact
  linked-family allowlist entry, and metadata may pass a mob only one level
  above the player to the authoritative `/check`. Live lease
  `bfaffa06-dcaa-4620-af6a-b7f75e2621db` checked each candidate as `tough` and
  excluded it without attacking. An isolated level 15–16 hare later checked
  `even match` and was also excluded. These tests validate the prefilter
  expansion without relaxing the combat admission rule.
- The level-15 Konschtat camp near `(-40.803, 436.784, 40.0)` has two level
  13–14 Mad Sheep and places the nearest aggressive spawn about 46 yalms away.
  Lease `6cc61920-ec4c-49ed-b91b-8b73af972c70` defeated both for 320 EXP in
  53 seconds with zero deaths, attack rejections, exclusions, target-cycle
  errors, combat teleports, or recoveries. It stopped normally at its
  two-fight limit.
- The local supervisor now supports optional same-zone camp rotation. After
  five seconds without an approved nearby target, it may select an exact
  allowlisted family whose metadata level is one to three levels below Pablo,
  whose spawn cluster is at least 20 yalms away, and whose nearest
  similar-elevation aggressive spawn is at least 40 yalms away. Relocation is
  refused during any live combat and uses the existing guarded same-zone
  private-server service teleport. Every selected cluster receives a
  five-minute cooldown.
- Lease `21e6d893-2482-403d-a3e3-320d5b42be5e` live-validated automatic camp
  rotation at Monk 15. It defeated five Mad Sheep for 780 EXP in 214 seconds,
  rotated among three vetted clusters, fired Combo once, and stopped at its
  fight limit. There were no deaths, recoveries, combat teleports, or recovery
  actions during combat. One moving sheep produced `Unable to see Mad Sheep`;
  the bounded line-of-sight attempt failed to retain range, so that exact
  target was cooled down and the supervisor continued at another camp.

## Usage

South Gustaberg is zone 107:

```sh
pnpm mcp:aggro-guard -- \
  --zone-id 107 \
  --maximum-seconds 900 \
  --maximum-engagements 30 \
  --confirmation "ARM PRIVATE SERVER SOLO AGGRO GUARD"
```

The legacy guard is defensive. The unified supervisor exposes a durable MCP
lease:

```sh
pnpm mcp:farm-start -- \
  --zone-id 107 \
  --maximum-seconds 900 \
  --maximum-fights 30 \
  --confirmation "ARM PRIVATE SERVER FARM SUPERVISOR"

pnpm mcp:farm-status
pnpm mcp:farm-stop -- --lease-id <active-lease-id>
```

For a long-running goal, run the local watchdog in a separate supervised
terminal:

```sh
pnpm mcp:farm-watch -- \
  --interval-seconds 15 \
  --confirmation "ARM PRIVATE SERVER FARM WATCHDOG"
```

The watchdog records its own ignored, owner-only heartbeat at
`runtime/farm-monitor/primary.json`. It renews only leases that end normally
with `time_limit` or `fight_limit`, preserving the prior guarded
configuration. Logout, death, stale supervisor heartbeats, inventory blocks,
manual stops, and unknown errors remain blocked for diagnosis instead of being
blindly restarted.

Watchdog renewal must pass every persisted spell field through
`farmRenewalConfig`, including the primary spell, level-gated upgrade, opener,
MP floors, self-buff, and self-buff interval. An RDM run exposed the failure
mode: the supervisor persisted these fields correctly, but an older watchdog
mapper silently omitted the newer options at each 30-minute renewal. The
renewal mapper now has a regression test covering the complete RDM spell
configuration. Restart the detached watchdog after changing renewal behavior;
editing the file does not replace an already running Node process.

Caster leases can also set `--minimum-start-mp-percent`. The default is zero,
which preserves the original HP-only recovery behavior. A positive value makes
the detached supervisor rest between fights until both the configured HP and
player MP reserves are restored. This prevents long RDM/BLM/WHM runs from
silently degrading into auto-attack-only combat after their initial MP is
spent, while reactive threats still interrupt recovery immediately.

The `--minimum-free-inventory-slots` margin applies before every proactive
pull in ordinary leveling as well as NM routes. A level-37 RDM run exposed that
the original check existed only inside the NM-route branch, allowing the
general loop to continue at four free slots despite a configured minimum of
five. The shared idle-boundary guard now drains live combat and stops with
`inventory_pressure` before another pull. Run the reviewed one-command cleanup,
verify restored capacity, and then start a new lease; the watchdog does not
renew inventory-pressure stops.

For a level-appropriate camp that admits `decent challenge` checks (including
high defense only while at least two healthy in-zone companions are verified):

```sh
pnpm mcp:farm-start -- \
  --zone-id 108 \
  --maximum-seconds 360 \
  --maximum-fights 3 \
  --scan-radius 30 \
  --allow-caution true \
  --auto-relocate true \
  --target-level 20 \
  --confirmation "ARM PRIVATE SERVER FARM SUPERVISOR"
```

Omit `--allow-caution true` to retain the safe-only default. Omit
`--auto-relocate true` to keep the lease at its starting camp. Automatic
relocation is currently same-zone only and never weakens the authoritative
`/check` admission policy. `--target-level 20` makes the local supervisor
refresh the in-game goal overlay after each completed fight and when the lease
ends, avoiding a model/MCP round trip just to update EXP progress. It also
stops the lease once level 20 is observed and no reactive threat remains.

For the level-20 progression profile, add `--auto-transition true`. The local
supervisor then:

- when started in South Gustaberg, keeps using same-zone camp rotation through
  level 13, then selects a metadata-vetted level-14 Mad Sheep cluster and
  performs a guarded combat-free transition to Konschtat Highlands;
- verifies or summons Valaineral, Joachim, and Mihli Aliapoh only while idle;
- keeps Konschtat as the active zone through level 16;
- at level 17, selects the real Valkurm
  Sand Hare cluster around `(647.616, -97.308, 0.312)`;
- requires the cluster's three level-16–17 candidates and 44.7-yalm nearest
  aggressive-spawn buffer before a guarded cross-zone service teleport;
- waits for a stable zone-103 observation, repairs missing Trusts, and resumes
  normal exact-check admission. At-level metadata is only a candidate:
  authoritative `/check` still rejects every actual `even match` result. The
  transition never runs during live combat.

`ffxi_farm_start`, `ffxi_farm_status`, and `ffxi_farm_stop` expose the same
controls directly to MCP clients. Runtime state and JSON event logs are stored
under the ignored, owner-only `runtime/farm-supervisor/` directory.

The level-17 transition and Valkurm rotation are live-validated:

- Zoning dismissed the existing Trust party. The first calibration exposed
  transient Trust recast ordering, so startup and post-zone repair now make
  two bounded summon passes and stop before combat unless Valaineral, Joachim,
  and Mihli Aliapoh are all observed.
- Valkurm level-17 rotation explicitly admits at-level Sand Hare metadata as a
  destination candidate. It does not admit that candidate to combat: lease
  `75682b7c-9770-47d8-9be2-0bb0ce7d19e8` rejected an actual `even match`
  Hare after `/check`, then continued with approved `decent challenge` Hares.
- That five-fight calibration earned 880 EXP in 267 seconds, performed four
  guarded camp relocations, fired Combo once, and recorded zero deaths, attack
  rejections, target-cycle errors, combat teleports, or recovery actions
  during combat.
- Reward accounting snapshots the event baseline before Trust summons so
  historical rewards from a prior lease cannot inflate the new lease.
- Above level 17, same-zone rotation returns to below-level metadata instead
  of spending time checking at-level candidates. Lease
  `14cb9905-796a-4a99-971e-fc053146539d` then completed 17 fights in 1,003
  seconds for 7,750 EXP, 16 guarded camp relocations, and seven Combos. It
  safely drained one reactive Brutal Sheep and recorded zero deaths,
  target-cycle errors, combat teleports, or recovery actions during combat.
- Fight 15 triggered a 5,000-EXP reward. FFXI advanced Pablo to level 19 at
  4,399/4,400; the reactive Sheep's delayed 240-EXP reward then advanced him
  to level 20. The supervisor originally sampled progress just before that
  delayed reward and began one unnecessary final Hare. It now holds proactive
  scouting for two seconds after the combat chain drains so reward and
  level-up state can settle before the next target decision.
- The final authoritative state was Monk 20 at 389/4,600 EXP, 100% HP and
  idle, with Joachim, Valaineral, and Mihli Aliapoh all healthy. The local goal
  overlay displayed `LEVEL 20 REACHED | AUTOMATED LEVELING COMPLETE`.

The Thief 1–20 run added two operational findings:

- Automatic level-band transition worked without model supervision. After
  Konschtat had no eligible below-level camp at Thief 18, lease
  `3d311328-e228-4536-8e8d-9be6255985c4` selected the validated Valkurm Sand
  Hare cluster, zoned combat-free, rebuilt Valaineral, Joachim, and Mihli, and
  resumed fighting.
- Broad same-zone relocation is not automatically equivalent to the pinned
  transition camp. At Thief 19 the lease eventually moved into a western
  Hare/Lizard pocket, began a pull at 75% HP, and took reactive Goblin Leecher
  aggro. Pablo was defeated after a long fight. Death recovery correctly
  selected the Home Point return, verified 100% HP in Bastok Markets, and
  stopped with `player_defeated_home_point`. The final 743-EXP recovery run
  therefore uses the original vetted Hare cluster, disables auto-relocation,
  and restores the 90% next-pull threshold. This is a bounded recovery profile,
  not a global reversal of the 75% throughput setting for already proven
  camps.
- Recovery lease `e4216c92-00b5-48ee-a33c-5bb91de11cee` rebuilt all three
  Trusts and defeated two Hares for 1,950 counted EXP in 108 seconds. It
  stopped itself at Thief 20 with zero deaths, reactive engagements, rejected
  attacks, target-cycle errors, combat teleports, or combat recoveries. One
  final live state call independently verified THF 20 / WAR 10 at
  1,207/4,600, with the goal overlay reporting automated leveling complete.

The Monk 25–30 profile extends the same model into Sauromugue Champaign:

- Level-25 metadata selected two level-25–26 Hill Lizards around
  `(-88.428, -88.830)` with a 53-yalm nearest aggressive-spawn buffer.
- Two-fight lease `95b2efd6-a39a-434c-84a3-d1acbea0121a` earned 690 EXP,
  used two Combos and eight Monk abilities, and stopped at its fight limit
  with zero deaths, rejected attacks, target-cycle errors, combat teleports,
  or combat recoveries.
- Proactive trusted-camp selection now excludes metadata-marked aggressive
  mobs. A mob that actually engages Pablo or a Trust remains an immediate
  reactive target; this narrows planned pulls without weakening defense.
- The level-25 automatic transition moves a continuous Valkurm run to
  Sauromugue Hill Lizard/Moon Bat camps. Same-zone relocation can then select
  the four-Diving-Beetle cluster near `(-258.104, 67.375)` from level 27; its
  nearest similar-elevation aggressive spawn is about 120 yalms away.
- Full lease `9ce4385a-b897-49fc-bd02-b528e535d0db` reached its one-hour
  safety limit after 59 fights. It reported 22,670 counted EXP, 48 proactive
  engagements, 12 reactive engagements and handoffs, 49 Combos, 178 Monk
  abilities, 55 safe camp relocations, zero deaths, and zero combat
  teleports/recoveries. Its clean time-limit stop left Pablo at MNK 29 with
  3,597/5,700 EXP.
- Renewal lease `f095c095-2030-4a8d-be4a-357a1beaab15` preserved the one-hour
  hard limit rather than widening the guardrail. It needed four fights,
  reported 2,180 counted EXP, and stopped itself on `target_level` with zero
  deaths. One final independent live state call verified MNK 30 / WAR 15 at
  77/5,800 EXP, 638 maximum HP, 130 attack, and 178 defense.
- Registration timeouts can occur during linked pulls. The reactive path kept
  the exact aggressor selected, retried once, and resumed combat; these
  recoverable rejections did not require model intervention. Proactive
  aggressive-mob exclusion remained intact throughout the run.

## Next iteration

1. Buy and equip the next level-appropriate Sparks upgrades.
2. Re-evaluate the next metadata band before resuming automated leveling.
3. Diagnose Vulture registration separately.
4. Record incoming action packets in AgentBridge so aggressor identity remains
   exact on a future shared server.

## Exact quest-drop supervisor

`mcp:farm-drop` is a narrow normal-gameplay loop for the Selbina support-job
quest. It accepts only the pinned Valkurm pairs Magicked Skull/Ghoul,
Damselfly Worm/Damselfly, and Crab Apron/Snipper. Selection requires a live
ordinary mob whose exported LandSandBoat drop metadata contains the exact
requested item with a positive rate. The loop performs no item grants, quest
state writes, or relocation.

The live local database reports Crab Apron item 539 at `itemRate = 100` on
all 49 ordinary Valkurm Snipper records. LandSandBoat's drop table uses a
1,000-point scale and defines 100 as 10%. The server retains the default
`DROP_RATE_MULTIPLIER = 1.0`, so the effective base chance is 10% per
qualifying Snipper before any Treasure Hunter effects. A 34-kill dry streak
therefore has probability `0.9^34`, about 2.8%: unusually unlucky, but not
evidence that the item is missing from the table.

Magicked Skull item 538 is present at `itemRate = 150` (15%) on all 36
ordinary Valkurm Ghoul records. Their exported level range is 18–24, which is
inside the trusted level-23 sweep envelope. The drop-biased relocation policy
selected a valid two-Ghoul metadata cluster near
`(-241.769, 121.158, -8.5)`. Ghouls remain subject to their normal
20:00–04:00 Vana'diel spawn window; the supervisor farms other admitted mobs
by day and gives a live Ghoul priority at night.

Ghoul records share `spawnslotid` values with ordinary Goblin placeholders.
Export schema version 2 therefore includes the slot ID, and the watched-drop
selector admits a live same-slot placeholder when the Ghoul itself is absent.
It still prefers a live Ghoul over that placeholder and both over unrelated
camp mobs. This prevents the controller from waiting at static Ghoul
coordinates while a Goblin occupies the authoritative spawn slot. Live
validation killed Goblin Gambler `17199472` and Goblin Leecher `17199477`
from Ghoul-capable slots, then selected Ghoul `17199551` when it spawned. The
first Ghoul dropped the Magicked Skull; the independent inventory watcher
stopped the lease with `quest_item_obtained`.

Before selecting a requested drop mob, every iteration checks for a live
engaged non-party entity. That exact entity is handed to `mcp-combat` with
pre-combat recovery disabled. The first live quest run exposed an important
policy mismatch: the supervisor detected a Tough Goblin Leecher correctly,
but the proactive `/check` gate refused it and Pablo died while the mob
continued attacking. The corrected reactive lease:

- requires the exact nearby entity to already have engaged status;
- requires at least two living in-zone Trusts;
- permits `tough` only for that reactive handoff;
- never permits a proactive Tough pull or any Very Tough or stronger check;
- commits once combat begins instead of disengaging at the low-HP threshold.

The fix was validated against two linked Tough Thread Leeches. Both were
selected without a model/UI decision and defeated normally; the second ended
with Pablo at 94% HP and advanced Monk to level 21. A current UI target is not
required because linked mobs may be attacking a Trust while another target is
still displayed; the authoritative exact entity status is used instead.

A later linked-Leech run exposed a separate registration failure: the mob was
already fighting a Trust, but Pablo's `/attack` could not see it across a
small terrain seam. The worker disengaged on the visibility stall and left
the Trust party fighting alone. Reactive retries now make a bounded
two-second nudge through the exact live target before reissuing `/attack`.
If a committed reactive target is still engaged when the worker exits, the
worker also preserves attack mode instead of sending `/attackoff`.
The same bounded registration retry recognizes FFXI's short
`You must wait longer to perform that action` cooldown response; it does not
wait eight seconds and misclassify that handoff as an engagement stall.
The nudge is also used for a nearby proactive target after an authoritative
visibility rejection. Merely entering battle stance is not treated as combat
evidence: Pablo or the exact target must actually lose HP before weapon-skill
logic and the longer combat monitor become active.

For unattended farming, use the durable supervisor's exact-item mode:

```sh
pnpm mcp:farm-start -- \
  --zone-id 103 \
  --quest-item-id 539 \
  --trusted-camp-sweep true \
  --maximum-seconds 3600 \
  --maximum-fights 100 \
  --scan-radius 30 \
  --minimum-start-hp-percent 80 \
  --allow-caution true \
  --auto-relocate true \
  --confirmation "ARM PRIVATE SERVER FARM SUPERVISOR"
```

With `--trusted-camp-sweep true`, `--quest-item-id` is a generic optional
inventory stop watcher for any valid item ID; it does not control target
admission. It does provide a preference: metadata-confirmed nearby drop
bearers are selected before other admitted camp mobs, and idle relocation is
biased toward their spawn family. If none are currently spawned, the
supervisor continues sweeping ordinary mobs instead of stopping. Without
trusted sweep, exact-family diagnostic selection remains restricted to the
three pinned Selbina items. The detached lease attacks every ordinary live mob
in the current
camp whose exported maximum level is no more than one level above Pablo,
provided it is on the same elevation. Worms remain excluded by the explicit
field preference. Aggressive and linking mobs are admitted because the
three-Trust composition has already been validated in this level band.

Trusted camp sweep deliberately skips per-pull `/check`. It still requires at
least two healthy in-zone Trusts immediately before a proactive engagement,
prioritizes any reactive threat, recovers between fights, and stops on death,
lost support, a zone/menu/session fault, the lease limits, or the watched
item. Relocation chooses another ordinary, level-bounded camp rather than a
camp for one drop-bearing family. This separates the reusable combat policy
from the optional farming outcome and makes unattended combat independent of
MCP analysis calls. `mcp:farm-drop` remains a short diagnostic lease.

The default trusted-sweep admission ceiling is one level above the player.
For an explicitly tested private-server camp whose database levels differ
from the historical guide, `--maximum-target-level-offset` may raise that
ceiling from 1 through 5 for that lease only. The configured value applies to
both nearby selection and relocation, is persisted for watchdog renewal, and
does not relax Trust, HP, inventory, session, combat, or death safeguards.

### Level-aware Monk abilities

`--auto-job-abilities true` enables a conservative main-job-aware Monk
rotation inside the durable supervisor. It executes abilities directly
through the same bounded `/ja` gameplay-command surface; a client macro is not
required. The policy unlocks and schedules:

- Boost at Monk 5, no more often than once per 15.5 seconds;
- Dodge at Monk 15, no more often than once per 300.5 seconds;
- Focus at Monk 25, no more often than once per 300.5 seconds;
- Chakra at Monk 35, no more often than once per 300.5 seconds and only at
  70% HP or lower.

There is a 2.5-second global gap between job-ability commands. Abilities are
issued only during a registered live fight and not when the target is below
10% HP. Hundred Fists is intentionally excluded from routine farming, as are
riskier or situational higher-level abilities such as Counterstance. Live
validation at Monk 23 recorded Dodge followed by two Boost uses during one
Snipper fight; the fight completed at 97% HP and the next fight continued
using Boost automatically. Pablo later reached Monk 25 during the same
durable campaign and used Focus automatically; the final Ghoul lease recorded
one fight, one reactive handoff, one weapon skill, three job abilities, 180
EXP, and zero deaths.

Warrior uses the same level-aware gate. Berserk becomes eligible at level 15
and retains its normal five-minute cooldown. The future low-friction ladder
adds Defender at 25 only when Pablo is at 50% HP or lower, party-wide Warcry at
35 while at least 60% HP, and Aggressor at 45 while at least 60% HP. Berserk
itself now requires at least 70% HP, preventing it from immediately replacing
an emergency defensive response. Provoke is deliberately excluded from
routine Trust-supported farming: Valaineral should retain tanking
responsibility, and a generic damage loop should not force Pablo to take hate.
Retaliation is excluded because its movement penalty conflicts with routing;
two-hour abilities remain reserved for explicit emergencies.

Long job-leveling leases treat Trust availability—not Trust level parity—as an
idle-state invariant. Before every proactive pull, the supervisor requires
Valaineral, Joachim, and Mihli Aliapoh to be alive and in the current zone. A
missing, defeated, or zone-dismissed Trust pauses new pulls while local summon
retries continue through the normal recast delay. Living Trusts are no longer
dismissed merely because Pablo gained levels; the extra strength did not
justify repeated refresh and recast friction.

This closes a live South Gustaberg failure: an Ornery Sheep used Sheep Song,
Valaineral died while the party slept, and the older lease continued pulling
until the remaining support failed. The first refresh calibration also showed
why a failed summon must not terminate the supervisor: two Trusts remained in
their post-dismiss unavailable window, and a nearby Goblin aggroed after the
lease stopped. The repaired policy stays alive, blocks proactive combat, and
retries locally. Live verification restored Valaineral, Joachim, and Mihli at
Warrior level 6 before the next pull.

The same calibration exposed a cooperative-stop edge case. A stop request
correctly blocked new pulls but also skipped repeated reactive attempts against
a Hornet already attacking Valaineral. Cooperative drain now suppresses only
proactive engagements; existing and newly observed reactive threats are always
finished before the idle window can complete. The replacement lease engaged
that exact Hornet in 196 milliseconds and continued farming.

The Warrior level-10 run exposed a second reactive edge case. A Goblin Thug
remained engaged with Valaineral at 28% HP after Pablo dropped to idle, while
the supervisor's target record still said `fighting`. The lease heartbeated
normally for more than a minute but could not finish the mob until an exact-ID
guarded attack was issued. The fight then ended at 97% HP. A policy-backed
recovery now detects an engaged, living reactive target within six yalms while
Pablo is idle, retargets its exact server ID, and reissues `/attack` after a
three-second gate. This keeps the Trust from fighting alone and avoids a
model-driven rescue for the same condition. The replacement lease
live-validated the branch on its next Goblin handoff:
`reactive_engagement_reissued` fired once at 0.94 yalms and the fight completed
immediately at 98% HP.

The same dropped-stance failure later appeared on a proactive Goblin at
Warrior 15. Pablo remained idle at melee distance while the untouched Goblin
reduced him to 42% HP. The recovery is therefore mode-independent: any tracked
living, engaged target within six yalms triggers an exact retarget and bounded
attack reissue when Pablo drops to idle. The replacement lease live-validated
the generalized branch on a proactive Mist Lizard at 1.16 yalms; it emitted
`engagement_reissued` once and completed the fight about 250 ms later.

An engaged Rock Eater also exposed a related range stall. At 4.56 yalms, Pablo
remained in battle stance but repeatedly received `out of range` while the
worm continued damaging the party. Mode-122 out-of-range events now enter the
same bounded line-of-sight movement recovery with a six-yalm maximum and the
existing three-attempt cap.

The first Warrior-19 Valkurm lease then exposed a movement sampling race:
Pablo moved more than six yalms from the computed nudge destination before
`ffxi_move_to_position` accepted it, so the bridge correctly rejected the
stale waypoint. That exact `max_start_distance` rejection is now treated as a
recoverable no-move result; other movement errors remain fatal. A focused
policy test pins the distinction. The interrupted reactive fight petrified and
defeated Pablo after the old process had exited, but the replacement lease
correctly returned to the Home Point. A guarded private-server combat-position
teleport returned him to the previously validated camp, where the supervisor
rebuilt the missing Trust party before resuming pulls.

The final Warrior-20 lease completed 24 fights for 4,670 EXP with 10 weapon
skills, four automatic Berserks, three post-zone Trust summons, no Trust
refreshes, and no deaths. It observed Warrior 20 / Monk 10 at 342/4,600 EXP,
updated the in-game goal overlay, drained the last reactive threat, and stopped
itself with reason `target_level`. A separate live character-state read
confirmed the same job levels and completed overlay.

An earlier complete level-10 refresh live-validated the long retry path:
after a partial repair immediately followed by a full refresh, Joachim and
Mihli remained unavailable for roughly four minutes. The supervisor stayed
alive at the vetted camp, blocked proactive pulls, retried both locally,
restored the complete party, and resumed combat without a process restart.
This is an edge case rather than the normal refresh duration: the clean
level-12 rebuild restored Valaineral, Mihli, and Joachim in 34 seconds. These
level-gap refreshes are retained as historical calibration only and are no
longer part of the active farming policy.

The first no-level-refresh lease also exposed a routing priority issue:
cross-zone progression was evaluated only after five seconds with no admitted
target. A broad sweep over respawning low-level mobs might never satisfy that
condition. Validated level-band transitions now run first whenever the player
is idle at the threshold. At Warrior 14 the replacement lease immediately
zoned from South Gustaberg to the vetted Konschtat Mad Sheep camp, repaired the
Trusts removed by zoning, and resumed combat without dismissing a living Trust
for level parity.

### Black Mage combat spells and level 20

The durable supervisor now supports one optional configured combat spell:

- `--combat-spell <name>` selects the allowlisted normal `/ma` command.
- `--maximum-combat-spells-per-fight` is bounded from zero through three.
- `--minimum-cast-mp-percent` prevents casting below the configured MP floor.
- A cast requires a registered fight, the exact selected target, engaged
  player and target stances, prior target damage, at least 20% target HP, and
  available per-fight cast budget.
- Job abilities, spells, and weapon skills are sequenced so the same sampling
  iteration cannot queue competing actions.

Pablo bought Stone, Water, Aero, Fire, and Blizzard through Zaira's normal
general-shop menus. The client sometimes advanced the default quantity-one
control before the next bridge observation; the purchase helper now accepts
only either the observed `menu    itemctrl` state or the exact subsequent
`menu    shopbuy` state, while retaining exact item-ID and final-decision
checks. Stone, Water, Aero, and Fire were learned normally. Blizzard remained
in Inventory until level 18, when `/item "Blizzard" <me>` produced the
authoritative `Pablo uses a scroll of Blizzard` event.

Fire was live-validated once per fight during the level-15-to-18 leases.
The final Blizzard lease then completed 28 fights, issued 28 Blizzard casts,
earned 8,433 counted EXP, performed eight normal recovery cycles, and recorded
zero deaths or combat teleports/recoveries. It stopped itself with
`target_level`. A separate live state call verified Black Mage 20 / Warrior 10
at 153/4,600 EXP, idle and logged in, with the overlay displaying
`LEVEL 20 REACHED | AUTOMATED LEVELING COMPLETE`.

### Red Mage enspell and opener support

Red Mage leveling adds two independently bounded spell roles without turning
the supervisor into a general spell bot:

- `--self-buff-spell Enthunder` casts the enspell only at an idle, combat-free
  boundary. `--self-buff-interval-seconds 150` prevents repeated attempts
  inside the normal effect duration, and a failed command still consumes that
  local attempt interval.
- `--opening-combat-spell "Dia II"` casts at most once per registered fight,
  only after both Pablo and the exact selected target are engaged.
  `--minimum-opening-spell-mp-percent 65` reserves the opener for healthy MP
  and prevents it from draining every pull.
- The existing `--combat-spell` remains the primary damage spell. Opening
  spell, job ability, primary spell, and weapon skill are mutually sequenced
  so one observation cannot queue competing actions. A shared five-second
  spell-command gate also prevents Trust, self-buff, opener, and damage casts
  from colliding with FFXI's action cooldown.
- `--combat-spell-upgrade "Stone II" --combat-spell-upgrade-level 35`
  changes the primary damage spell locally as soon as the observed main-job
  level reaches 35; no model poll or supervisor restart is required.
- The self-buff is never attempted during live combat, while zoning, or while
  the player is not idle. Normal death, disconnect, Trust, inventory, and
  target-level stop gates remain unchanged.

The intended RDM 34 configuration uses Enthunder for sword-hit damage, Dia II
as the MP-gated opener, and Thunder as the once-per-fight nuke. At RDM 35 the
configured upgrade automatically selects the already learned Stone II; Water
II remains reserved for RDM 40.

### Exact lottery prototype

An exact lottery selector now admits configured placeholder and notorious-
monster server IDs while continuing to reject unrelated normal mobs. It sorts
an active NM ahead of its placeholder and respects the existing live, range,
level, elevation, and cooldown gates.

The first profile targeted Leaping Lizzy's exact Rock Lizard placeholder
`17215867`, Lizzy IDs `17215868` and `17215888`, and Bounding Boots item
`15351`. A bounded 20-minute run killed the placeholder four times without an
NM spawn, handled three incidental threats reactively, and stopped on its time
limit with zero deaths. The measured placeholder cycle was approximately
five to five-and-a-half minutes.

The prototype's two-second four-point sweep was intentionally diagnostic and
produced 327 relocations. Do not generalize that cadence. The validated
four-camp implementation moves on immediately after its configured
placeholder quota is dead and lets the route itself absorb respawn time. See
`docs/notorious-monster-loop.md`.

### Argus and Leech King alternating camp

Maze of Shakhrami does not use ordinary Protozoans as Argus placeholders. The
pinned zone script alternates one timed slot between Argus (`17588674`) and
Leech King (`17588685`): the initial delay is randomly 15–120 minutes and a
defeat starts a new random 60–120 minute delay for the other NM. Killing nearby
Protozoans therefore does not accelerate the lottery.

Use an exact objective with one non-completing support target:

```sh
--objective-target-name Argus \
--objective-support-target-name 'Leech King' \
--objective-kill-count 1
```

The selector always prefers live Argus when both names are observable. A Leech
King defeat counts as an ordinary/support fight and never increments
`objective_kills`; it merely clears the alternating slot so Argus can become
the next timed spawn.

The live camp exposed a broken collision pocket near Leech King's randomized
position. A client could reach within one yalm and still receive `Unable to see
the Leech King`. Normal retry plus a guarded service-teleport nudge remains the
first response. Only after two fresh normal attack failures may the supervisor
queue `ffxi_private_server_nm_reposition`. Both AgentBridge and the server then
require all of the following:

- Pablo is idle, logged in, menu-free, and in zone 198;
- the ID is exactly Argus or Leech King and the name matches;
- the NM is naturally spawned, alive, and within ten yalms;
- the fixed confirmation phrase is present.

The server command cannot spawn, despawn, damage, defeat, or reward the NM. It
only moves that already-live entity to Pablo, after which the supervisor must
observe it within four yalms and complete an ordinary fight. This preserves
the timer, combat, drop ownership, and server RNG while removing a verified
geometry failure.

### Verified Elder Memories completion

The normal quest finished without grants or quest-state writes:

1. The trusted sweep acquired item 538, item 537, and item 539 through
   ordinary Valkurm combat.
2. Exact client item commands traded Magicked Skull, Damselfly Worm, and Crab
   Apron to Isacio in that required order.
3. Isacio's closing dialogue emitted `You can now designate a support job`.
4. A read-only server query verified `char_jobs.unlocked = 127`, changed from
   the pre-quest baseline of 126.
5. The ordinary Mog House menu selected Warrior as support job; AgentBridge
   reported main job 2 level 25 and support job 1 level 1.

This run is the reference operating model for future camp goals: Codex chooses
the camp and stop condition, the detached local supervisor continuously kills
all admitted ordinary mobs, and Codex returns only for a hard stop or durable
outcome. Per-fight inventory reads, strength checks, and model decisions are
not part of trusted-camp mode.

### Low-level EXP prerequisites

Before starting a fresh low-level job lease, verify the character's available
normal EXP accelerators once, outside the combat loop. For the Thief run,
Pablo completed the normal Bastok tutorial, received Signet, exchanged its
Conquest promotion voucher for an Empress Band, equipped it, waited through
the activation delay, and used it. The lease began only after AgentBridge
simultaneously reported Signet `253`, Dedication `249`, and Food `251`.

Legacy multi-choice tutorial menus must be handled one screen at a time.
Gulldago's decisive `Sure am.` choice is the fourth row and can be hidden below
three repeat-explanation choices. A generic dialogue loop selects the first
row repeatedly and makes no progress; it is not safe for that menu.

The first Thief lease used the historical 90% next-pull HP threshold. With
living level-3 Trusts intentionally retained under the death-only refresh
policy, post-fight recovery from roughly 75–88% created repeated 20–35 second
gaps. The lease was cooperatively stopped only after its reactive chain
drained, then replaced with a 75% threshold. Valaineral had genuinely fallen
during that final chain, so the replacement lease restored him once at Pablo's
current level 10 (215 HP rather than 80 HP). It completed its first six fights
in 116 seconds without a recovery wait. This preserves the operator's rule:
do not inspect or refresh Trusts at every level; repair only an actually
missing, defeated, or zone-dismissed member.

The Thief run also validated that zone selection must remain level-aware even
when an operator temporarily prefers the faster-looking earlier camp. A short
current-level Konschtat comparison pushed Pablo to level 18 through normal
combat and RoE rewards. The next detached lease then found no relocation camp
inside its `player level - 3` floor: the high camp's level-13–14 sheep had
aged out. Re-enabling `auto_transition` made the supervisor choose its pinned
five-Sand-Hare Valkurm cluster, verify a 61-yalm aggressive-spawn buffer,
perform the guarded cross-zone placement, rebuild all three zone-dismissed
Trusts, and resume combat without MCP polling. This is the intended low-token
operating model: use local deterministic level thresholds for camp changes and
reserve MCP/Codex calls for hard events or completed goals.

Konschtat also exposed `Rock Eater` as a second named Eater variant of the
burrowing worm family. Combat admission, relocation selection, and the
read-only scout now exclude `Rock Eater` alongside names containing `worm` or
`Stone Eater`. The already-engaged discovery fight was allowed to finish
before the corrected lease was started.
