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

- verifies or summons Valaineral, Joachim, and Mihli Aliapoh only while idle;
- keeps Konschtat as the active zone through level 17;
- after level 18 exhausts the approved sheep band, selects the real Valkurm
  Sand Hare cluster around `(647.616, -97.308, 0.312)`;
- requires the cluster's three level-16–17 candidates and 44.7-yalm nearest
  aggressive-spawn buffer before a guarded cross-zone service teleport;
- waits for a stable zone-103 observation, repairs missing Trusts, and resumes
  normal exact-check admission. The transition never runs during live combat.

`ffxi_farm_start`, `ffxi_farm_status`, and `ffxi_farm_stop` expose the same
controls directly to MCP clients. Runtime state and JSON event logs are stored
under the ignored, owner-only `runtime/farm-supervisor/` directory.

## Next iteration

1. Extend the validated same-zone camp rotation through Monk 16 and 17 while
   collision-aware routing remains unproven.
2. Live-validate the automatic level-18 transition to Valkurm; retain
   exact-check rejection for `even match`, `tough`, and higher.
3. Diagnose Vulture registration separately.
4. Record incoming action packets in AgentBridge so aggressor identity remains
   exact on a future shared server.
