# Navigation

Status: world-coordinate movement, navmesh routing, NPC interaction, a
multi-zone transition, bounded combat, recovery, and level progression are
validated.

## Why camera input is not the navigation layer

FFXI's normal forward key is camera-relative. It is useful for a manual fallback
or an input-bridge test, but it is too brittle for autonomous questing. Camera
pan, frame timing, and collision geometry should not be part of the agent's
route-planning contract.

Ashita's official `IAutoFollow` interface exposes `FollowDeltaX` and
`FollowDeltaY`. AgentBridge 0.9.1 normalizes the vector from the character's
current world position to a requested waypoint, writes those deltas, and
recomputes the vector every 100 ms. This moves toward world coordinates without
depending on the camera.

The MCP operation is `ffxi_move_to_position`. Like entity movement, it is
bounded by:

- an explicit control latch;
- maximum starting distance;
- arrival distance;
- timeout;
- lack-of-progress timeout;
- login state;
- explicit movement stop; and
- emergency stop.

The `mcp:navigate` helper exercises one coordinate waypoint:

```sh
pnpm mcp:navigate -- --x -253.67 --y -92.33 --timeout 6
```

In the live Bastok Markets test, this moved Pablo from 4.60 yalms away from
Enu's coordinates to 0.97 yalms and stopped with the `arrived` reason.

## LandSandBoat navmesh routing

Straight world-coordinate movement still collides with walls. LandSandBoat
already ships Recast/Detour `.nav` meshes for its server-side NPC pathfinding,
so the host planner should query the same mesh and send only the resulting
short waypoints through MCP.

The ignored runtime copy for Bastok Markets can be obtained from the local map
container:

```sh
mkdir -p runtime/navmeshes
docker cp \
  ffxi-agent-lab-map-1:/server/navmeshes/Bastok_Markets.nav \
  runtime/navmeshes/Bastok_Markets.nav
```

Do not commit mesh binaries. They are supplied by the pinned LandSandBoat mesh
image and remain in ignored runtime storage.

LandSandBoat and `recast-navigation` both use the standard `MSET` Detour tile
container, so no proprietary map or client asset is required. FFXI and Detour
use different axis conventions:

```text
Detour x = FFXI x
Detour y = -FFXI z (vertical)
Detour z = -FFXI y
```

`src/navmesh-planner.mjs` performs that conversion, imports the mesh, and asks
Detour for a straight path across the polygon corridor. The path runner then
executes each vertex as a bounded `ffxi_move_to_position` lease:

```sh
pnpm mcp:pathfind -- \
  --mesh Bastok_Markets.nav \
  --x -114.777 \
  --y -113.301 \
  --z -4
```

The first live query from G-9 to Nbu Latteh produced 19 route points. It
correctly routed north to the G-8 approach before crossing east, disproving the
earlier visual guess that the bridge entrance was south. That first run stopped
safely at a tight corner. After a clean login and the movement-vector fix, the
same route completed all 21 generated waypoints, including that corner, and
stopped 0.66 yalms from Nbu Latteh.

The MCP interaction helper then targeted Nbu, opened event 230, and advanced
five guarded confirm steps. The game closed the dialogue and reported
`Obtained: Fire crystal`, validating acceptance of the Bastok quest
**Mom, the Adventurer?**

## Observable item menus

AgentBridge 0.16.0 exposes Ashita's read-only interface-visibility flag,
focused-menu name, and selected-item fields alongside `menu_open`: item ID,
inventory slot, display name, and whether the selection is active. The
focused-menu pointer follows the guarded
read chain used by Ashita v4's official `autologin` addon. This lets an agent
validate menu transitions instead of guessing from screenshots or injecting
trade packets. Names remain untrusted display data; item decisions key on the
numeric item ID.

With an inventory-style menu already open, move down one bounded key event at
a time until an exact item ID is selected:

```sh
pnpm mcp:prepare-trade -- \
  --target Reet \
  --server-id 17739836 \
  --item-id 536

pnpm mcp:select-item -- --item-id 536
```

The trade preparation helper proves and selects the exact nearby NPC and
proves the requested inventory item, then disarms without opening a menu.
The selection helper requires the game to expose an active item selection. It
stops without confirming the item, emergency-disarms control, and reports
every observed selection. A separate
`mcp:menu -- --action confirm` call is required for the consequential step.
Shop stock can be selected by numeric ID with
`--allow-not-in-inventory`, but the same separate-confirm boundary remains.

FFXI does not open an NPC item handoff through `/trade <t>` on this client.
The normal main menu can therefore be opened with one separately gated
AgentBridge DirectInput pulse:

```sh
pnpm mcp:menu -- --action open_main_menu
```

`open_main_menu` is accepted only while AgentBridge reports the menu closed;
confirm, cancel, up, down, left, and right require it open. AgentBridge 0.16.0
injects only
the corresponding fixed DirectInput scan codes and releases each key
automatically. This replaces the focus-sensitive Parallels key-event path.
`show_interface` remains a separately named recovery action for Scroll Lock.
It requires all menus to be closed and a guarded memory read proving that the
interface is hidden, so it cannot accidentally hide a visible interface.

Live menu identity checks mapped `menu    menuwind` to the main menu,
`menu    region` to Region Info, `menu    handover` to the NPC handoff window,
and `menu    inventor` to its inventory picker. Opening the empty handoff slot
made Ashita's selected-item fields active; `mcp:select-item` then traversed the
inventory and proved item ID 536 before any item confirmation. The legacy
handoff window's empty slots and final action controls still do not expose
distinct semantic labels, and the VM capture path omits that native layer.
Do not infer those controls from remembered key counts.

For a single item handed to an NPC, the normal FFXI `/item` command is a
camera-independent fallback that avoids the legacy Trade window's hidden
cursor geometry. The helper still proves the exact nearby NPC by name and
server ID, proves the exact inventory item by numeric ID, derives the quoted
item name from the client's resource-backed inventory observation, and
verifies either immediate item consumption or that a quest dialogue started:

```sh
pnpm mcp:trade-item -- \
  --target Reet \
  --server-id 17739836 \
  --item-id 536
```

The helper does not accept command text and cannot send chat, GM commands,
addon commands, scripts, or packets. It refuses to run while any in-game menu
is open by default. If a legacy NPC handoff is already stuck in the observed
`handover` or `inventor` menu, `--allow-open-trade-menu` explicitly permits
the same exact-ID-verified command as a recovery attempt; no other open menu
name is accepted.

Some NPC handoffs consume the item only after their dialogue finishes. In that
case the helper returns `reason: "dialogue_started"` without claiming that the
item was consumed. Advance the bounded dialogue and then verify both inventory
and reward:

```sh
pnpm mcp:dialogue -- --max-steps 6
pnpm mcp:state
```

The Reet coupon handoff validated this two-stage path: the normal `/item`
command opened `menu    rem4li2 ` dialogue, two guarded confirms closed it,
the client logged `Obtained 50 gil.`, item ID 536 disappeared, and Pablo's gil
increased from 10 to 60.

Long straight Detour route legs are also subdivided into 20-yalm leases by
default. `--maximum-segment-distance` accepts 5 through 50 yalms. This keeps
every movement command well inside AgentBridge's 100-yalm start bound and
makes progress observable even when Detour returns only a start and endpoint.

The return route from South Gustaberg to Reet completed without camera
steering after subdivision. Teleportation, GM movement, and packet injection
are therefore unnecessary for the current vertical slice. Keep teleportation
only as an explicitly enabled private-test recovery tool if later zones prove
unrouteable; it should never silently replace a failed normal route.

The next route crossed Bastok Markets to its southwest boundary. Detour ended
at the last walkable polygon; a short second path around the wall reached the
zone line and produced:

```text
=== Area: South Gustaberg ===
```

The path runner currently reports this successful transition as a failed final
waypoint because the new zone resets world coordinates. Zone-change detection
must take precedence over same-zone arrival checks in a future runner.

Detour may also return a path to the edge of a disconnected polygon corridor
with a success status even though the requested destination was not reached.
The host planner rejects these partial endpoints instead of allowing the runner
to treat them as a usable route.

Copy the outdoor mesh in the same way:

```sh
docker cp \
  ffxi-agent-lab-map-1:/server/navmeshes/South_Gustaberg.nav \
  runtime/navmeshes/South_Gustaberg.nav
```

South Gustaberg navigation then moved Pablo to less than 11 yalms from a Huge
Hornet without using the camera.

### Live collision mismatch near the Bastok approach

A later South Gustaberg run exposed a reproducible mismatch between the server
mesh and client collision near the scaffolded embankment around
`(304, -300)`. Detour produced a tight switchback from z `-6.3` to z `-3.0`.
The client reached the first three points, failed to make progress on the
fourth, and slid back down the slope. Replanning twice from the observed stop
position correctly failed closed, but generated the same corridor because the
mesh contains only that connection.

Temporarily excluding the failed polygon proved that no alternate connected
corridor exists in this mesh component. Detour returned a nominally successful
partial path that ended about seven horizontal yalms from the requested
destination; the planner now rejects that case.

Short world-coordinate probes mapped the client collision without relying on
camera-relative movement. Pablo safely descended west along the lower contour
to approximately `(250, -296, -13.9)`, with each probe bounded by timeout,
lack-of-progress detection, an entity scan, and emergency disarm. This live
evidence establishes the next recovery requirement: persist collision-derived
blocked edges and support a bounded probe graph for isolated mesh components.
The camera view was used only to correlate the failing edge with the visible
embankment, not to steer.

### Bounded collision-probe recovery

`mcp:probe-route` turns those manual probes into a bounded recovery layer:

```sh
pnpm mcp:probe-route -- \
  --mesh South_Gustaberg.nav \
  --x 240 --y -305 --z -17 \
  --max-probes 8 \
  --step-distance 6 \
  --minimum-entity-distance 12 \
  --minimum-hp-percent 90
```

The runner:

- generates goal-biased world-coordinate candidates at eight relative angles;
- rejects candidates near observed entities, previously failed endpoints, or
  destination-specific visited nodes;
- classifies each lease as arrived, partial progress, or stalled using observed
  displacement;
- treats every unreached endpoint as collision evidence while preserving a
  partial endpoint as a reachable node;
- scopes cycle avoidance to one destination so a later route may safely
  backtrack over known ground;
- stops on arrival, probe limit, no remaining safe candidate, low HP, or a
  nearby entity;
- performs each precondition and hazard scan while disarmed, then opens the
  write latch only for one movement lease and emergency-disarms before the next
  observation;
- appends private mode-`0600` JSONL evidence to
  `runtime/navigation/collision-probes.jsonl`; and
- calls `ffxi_emergency_stop` and reports the final disarmed control state.

The first live run recovered from the western shelf to a lower corridor while
Pablo remained at 100% HP. Six-yalm probes efficiently traversed open contour
segments; three-yalm probes resolved narrow wall corners and prevented a
two-node oscillation. A proposed lower-basin coordinate was proven to be across
another client wall, so the runner explored the reachable corridor and stopped
instead of clipping through collision.

LandSandBoat spawn data is useful for selecting a safe recovery destination,
but the database axes differ from AgentBridge observations:

```text
AgentBridge x = mob_spawn_points.pos_x
AgentBridge y = mob_spawn_points.pos_z
AgentBridge z = mob_spawn_points.pos_y
```

Queries must also constrain the zone's mob ID range; `mob_groups.groupid` is
reused across zones and is not sufficient by itself to associate an arbitrary
spawn row with South Gustaberg. The live database check identified night-only
level 2–3 Ding Bats on the lower component. The nearby daytime Stone Eater was
level 3–4, and `/check` reported “seems tough” with high defense, so the agent
correctly refused combat.

## Bounded combat

Time-gated targets can be watched without arming AgentBridge:

```sh
pnpm mcp:wait-target -- \
  --target "Ding Bats" \
  --timeout 55 \
  --poll-seconds 5 \
  --maximum-distance 30 \
  --maximum-elevation-difference 4
```

The watcher is read-only. It accepts one or more exact `--target` names and
returns only a live entity that is active, has HP, is inside the distance
bound, and is on approximately the same elevation as the player. This prevents
the host from selecting a visually nearby monster on the inaccessible side of
a cliff. Its timeout is capped at 55 seconds so longer watches remain
observable and cancellable.

The first live watch performed eleven polls for lower-component Ding Bats,
found none during their daytime despawn window, and left AgentBridge disabled.

Before combat, convert the game's `/check` text into a machine-readable safety
decision:

```sh
pnpm mcp:check-target -- \
  --target "Ding Bats" \
  --server-id 17215559 \
  --maximum-distance 20
```

This helper requires the exact observed name and server ID, verifies that the
entity is active and inside the distance bound, then issues only target and
`/check` commands. It classifies “too weak” and “easy prey” as `safe`, “decent
challenge” as `caution`, and “even match” or any tougher result as `unsafe`.
Missing, stale, or unrecognized chat evidence becomes `unknown`, returns a
failure status, and must block combat. The helper never moves or attacks and
always reports the final emergency-disarmed control state.

Live validation against Maneating Hornet `17215550` returned `tough`,
`high_defense: true`, and `verdict: unsafe`; no attack was sent. An earlier
attempt against a roaming Ding Bats also failed before control was armed when
the exact entity left the observation radius. These two cases verify both
game-derived rejection and precondition rejection.

The check helper also waits for the client to report the requested server ID
as its active target before sending `/check`. This additional verification was
added after two live Tunnel Worms shared the same display name: one exact ID
appeared in entity memory but the client would not accept it as a target. The
old sequence produced a generic command error; the strengthened sequence
failed before sending `/check`, while the targetable worm ID succeeded.

AgentBridge 0.16.1 observes Ashita's active target slot correctly when the
client enters subtarget mode and exposes `target_slot` plus
`subtarget_active`. The check and combat helpers first use the exact-ID bridge
setter. If the client does not acknowledge it, they may issue only the normal
allowlisted `/target "observed name"` command and still require the resulting
active target's server ID to equal the requested ID. Duplicate names therefore
remain fail-closed.

Coordinate proximity is not proof of targetability. A client wall can separate
an observed entity from Pablo, while worm-family mobs also have a periodic
burrow window in which they remain in entity memory but cannot be selected.
The helpers do not weaken verification in either case. A bounded disarmed wait
tests the temporal case first; navigation around known collision is appropriate
only after that wait expires or route evidence identifies a wall.

`mcp:combat` composes existing narrow MCP tools rather than expanding the
bridge protocol. It:

- selects one exact nearby entity;
- rests to a configurable minimum starting HP when necessary;
- approaches it with a leased entity-follow movement;
- if Ashita immediately cancels that low-level lease, uses the normal bounded
  `/follow <t>` command against the already verified exact target;
- refuses to attack outside the configured range;
- reacquires and verifies the exact server ID after movement;
- issues `/check` and waits for an authoritative result in the same process;
- rejects unknown and unsafe checks, and rejects caution unless explicitly
  allowed;
- catches the same exact entity again if it roams during `/check`;
- sends only `/attack <t>`;
- on a pre-engagement visibility rejection, re-follows and retries that same
  exact server ID up to the configured bounded attempt limit;
- samples player and target HP once per second;
- optionally triggers one configured weapon skill when combat is proven active,
  the exact target remains selected, and TP is at least 1,000;
- stops at a configurable player-HP floor, target defeat, logout, or timeout;
- sends `/attackoff`; and
- always invokes the emergency stop before exit.

When retreat routing is not yet proven and the operator explicitly chooses to
finish an engagement, pass `--commit-once-engaged`. The helper still records
HP samples, but it does not treat the HP floor as a reason to issue
`/attackoff`; it continues until the target is defeated, the client logs out,
or the combat timeout expires.

Example:

```sh
pnpm mcp:combat -- \
  --target "Huge Hornet" \
  --server-id 17215525 \
  --max-start-distance 10 \
  --minimum-start-hp-percent 90 \
  --minimum-hp-percent 40 \
  --combat-timeout 90
```

For an explicitly committed engagement:

```sh
pnpm mcp:combat -- \
  --target "Walking Sapling" \
  --server-id 17215660 \
  --allow-caution \
  --commit-once-engaged \
  --attack-attempts 3 \
  --weapon-skill "Combo" \
  --minimum-hp-percent 35 \
  --combat-timeout 120
```

This is the preferred hunt handoff. It performs exact targeting, follow,
close-range `/check`, optional catch-up, and attack without returning control
between stages. `--allow-caution` admits a game-derived `decent challenge`
result; omit it to require `easy prey` or `too weak`. `tough`, `very tough`,
`incredibly tough`, and `even match` remain rejected.

`--attack-attempts` defaults to `3` and is capped at `3`. A server-side
`Unable to see` or `Unable to attack` response before either combatant takes
damage triggers a short same-ID re-follow, exact-target verification, and
another `/attack <t>`. A rejection after combat has begun is never retried.
This keeps transient attack registration inside one deterministic handoff
without permitting target substitution or an unbounded loop.

The bounded retry was subsequently exercised live against Walking Sapling
`17215661`: the first attack returned `Unable to see the Walking Sapling`,
the helper recorded `retry_allowed: true`, re-followed and re-verified the same
server ID, and the second attack defeated it for 160 EXP. No operator decision
or target-selection round trip occurred between those stages.

The normal `/follow <t>` fallback is monitored four times per second, stops
inside the configured attack range, and fails closed if auto-follow stops,
the exact entity disappears, login state changes, or the approach timeout
expires. It does not replace navmesh routing for long travel; it only closes
the final short gap to a moving exact-ID target.

`--weapon-skill` is an optional macro-like combat action. It is never sent
during approach, `/check`, or attack-registration retry. The helper waits
until player or target HP proves that combat has begun, requires the active
target to remain the pinned server ID, requires at least 1,000 TP, and rate
limits attempts to one every five seconds. It also withholds the action below
10% target HP rather than waste TP on a normal-hit finisher. This keeps
deterministic action timing local while MCP retains exact target selection,
safety policy, and the structured result. For the level-7 Monk loop, the
intended value is `Combo`.

The first live `Combo` validation targeted Rock Lizard `17215659`. Combat
reduced the lizard to 84%, which proved engagement; the helper observed 3,000
TP and the same active server ID, then queued one `/ws`. The client reported
`Pablo readies Combo` followed by 95 damage and target defeat. Pablo took no
damage, gained 160 EXP, and the full invocation completed in about 14 seconds.
A later sapling test reached 1,000 TP only after the target fell to 3%; its
normal hit landed first and the queued Combo was rejected. The 10% finisher
guard was added from that evidence.

Normal FFXI macros are useful later for deterministic actions such as a weapon
skill, healing, or a stable menu sequence. They are not the targeting layer:
macros cannot pin a server ID, distinguish duplicate display names, or wait for
and parse an asynchronous `/check` result. Keep exact selection and the combat
gate in AgentBridge/MCP, then use narrowly scoped macros only after that gate.

Use `--server-id` when multiple nearby entities share the same display name.
The ID comes from `ffxi_observe`; the bridge still validates that the entity is
nearby before targeting it. AgentBridge 0.9.1 makes an explicit server ID
authoritative; name matching is only a fallback when no ID is supplied. This
fixed an ambiguity where a corpse or a different live Huge Hornet could be
selected because several entities shared the same name.

The standalone entity-follow helper accepts the same exact-ID pin:

```sh
pnpm mcp:move -- \
  --target "Walking Sapling" \
  --server-id 17215660 \
  --max-start-distance 30 \
  --stop-distance 1 \
  --timeout 15
```

This matters for roaming mobs with duplicate display names. A live South
Gustaberg test caught a Walking Sapling from more than 20 yalms away, after
which the exact-ID check and committed combat loop defeated it. Name-only
follow remains available for unique targets, but automation should pin the
observed server ID.

### Collision-safe route recovery

Do not disable client collision or use wall-hack behavior on the retail
service. Long direct coordinate movement can cut across collision even when
both endpoints are valid. Use the zone navmesh with short segments instead:

```sh
pnpm mcp:pathfind -- \
  --mesh South_Gustaberg.nav \
  --x 344 \
  --y -261 \
  --z 0 \
  --maximum-segment-distance 10 \
  --max-replans 2 \
  --recover-stuck
```

When `--recover-stuck` is enabled and a segment stops more than two yalms from
its waypoint, the helper sends one bounded backward pulse, observes the new
position, and replans from there. Recovery is capped by `--max-replans`, and
the helper still invokes the emergency stop on every exit. The pulse defaults
to 750 ms and can be set from 50 through 1000 ms with
`--recovery-pulse-ms`.

Live validation exposed a field collision seam where direct movement repeatedly
reported `no_progress`. A one-second reverse pulse freed the character, and a
13-segment South Gustaberg navmesh route then reached the camp within 0.55
yalms. This is the preferred camera-independent recovery path; repeated visual
wall inspection should be treated as a debugging fallback.

A later route south exposed a second collision mismatch near `(407, -519)`,
where the navmesh crossed between crates and a structure. The safe local detour
was to back north to approximately `(400, -510)`, move west to `(390, -510)`,
cross south near `(390, -526)`, and then resume the navmesh route. The
remaining 75 yalms completed with 10 of 10 waypoints, no replans, and 0.73
yalms of final error.

That detour also exposed an aggro-monitoring failure: an Amethyst Quadav and a
linked Young Quadav attacked during repeated collision recovery, while the
scout summary omitted player HP and events. Pablo was defeated before a later
separation command began. Coordinate and navmesh movement now sample live
player state during every lease and abort immediately on HP loss, defeat, or
login-state change. The read-only scout now includes the full bounded player
summary and recent events, and it suppresses target recommendations while the
player is defeated or otherwise non-operational.

Recovery can also be run independently:

```sh
pnpm mcp:rest -- --minimum-hp-percent 90 --timeout 75
```

The helper toggles `/heal`, samples HP every two seconds, stands after reaching
the threshold, and always invokes the emergency stop. In the live test it
restored Pablo from 57% to 100% without changing world position.

The first live invocation failed closed before sending `/attack` because the
map server had already been terminated by its two-second inactivity watchdog.
The QEMU-safe watchdog configuration and recovery are documented in
[troubleshooting.md](troubleshooting.md).

### Live leveling evidence

The first gated leveling loop on the upper South Gustaberg plateau used this
sequence for every fight:

1. read-only entity observation;
2. exact name and server-ID `/check`;
3. require `verdict: safe`;
4. bounded exact-ID combat with a 90% starting-HP requirement and a 70% HP
   alert floor; and
5. verify defeat, EXP, character state, and emergency-disarmed control.

Five fights against targetable Tunnel Worm `17215530` completed successfully.
Each produced a defeat event and 140 EXP while Pablo remained at or above 89%,
95%, 93%, 81%, and 93% HP respectively. Character EXP progressed from 140 to
280, 420, 560, and 700 out of 750 at Monk level 2. The fifth victory advanced
Pablo to Monk level 3 at 90/1000 EXP, raised maximum HP from 48 to 63, attack
from 17 to 19, and defense from 28 to 30. The client independently emitted
`Pablo attains level 3!`. Hand-to-hand and defensive skills also increased,
and the inventory observation recorded two beastmen's seals.

After the Reet coupon handoff, another three exact-ID Tunnel Worm fights
advanced Pablo from 220 to 610 EXP at Monk level 3. Each produced a defeat and
130 EXP event; the lowest observed HP values were 92%, 82%, and 95%, and
attack increased from 19 to 20. No Flint Stone dropped in those first three
attempts. The local drop table identifies a 150/1000 Flint Stone rate for this
South Gustaberg worm and a five-gil base sell value. Combined with the
quest-reward Fire Crystal's 15-gil base sell value, one legitimate Flint Stone
drop supplies the 20 gil needed to close the 19-gil Copper Ring purchase gap.

The same run found Vulture `17215662` in normal line of sight. The client said
it “seems like an even match” with high defense; the verdict parser now treats
both that wording and “evenly matched” as `unsafe`, and no attack was sent.

The final two fights ran with AgentBridge 0.10.0's local activity feed enabled.
The game chat displayed sanitized target IDs and `/check`, `/attack`,
`/attackoff`, and `/heal` verbs alongside the game's normal combat, EXP, and
level-up messages. The feed remained enabled after emergency stops, while the
write latch itself returned to disabled.

Huge Hornet `17215527` also checked as `easy_prey`, but it demonstrated why a
generic `/check` verdict is not a complete mob-policy layer. The combat HP
floor triggered with the hornet at 9%; `/attackoff` did not disengage it, and
the mob then used Final Sting and fell without producing a defeat or EXP
event. Hornets are therefore excluded from this leveling loop. Treat the
combat HP floor as an alert and best-effort attack stop, not as a guaranteed
escape from an already-hostile mob.

The route to the targetable worms exposed two client-collision corrections to
the South Gustaberg navmesh:

- the ramp switchback near `(304, -305)` must go south to approximately
  `(303.5, -306.5)`, cross east near `(305.5, -306.5)`, and then climb north;
- a plateau wall near x `326–327` blocks direct westward movement around
  y `-281`, but can be passed south near y `-290`.

These corrections were derived from bounded world-coordinate leases and
post-move observations. Screenshots were used only to confirm the visible wall,
not to steer the character.

After that server fix, four Huge Hornet encounters validated the full loop:

- each target was selected by its observed server ID;
- the helper re-verified the same ID immediately before `/attack <t>`;
- all four fights ended with `target_defeated`, and Pablo never crossed the 40%
  emergency HP floor;
- each fight awarded 160 EXP; and
- the fourth fight changed the authoritative character state from Monk level 1
  at 480/500 EXP and 33 maximum HP to Monk level 2 at 140/750 EXP and 48
  maximum HP.

The client event stream independently reported `Pablo attains level 2!`.

### Treasure-casket timing and menu evidence

Treasure Caskets are timed side objectives and should be handled immediately
after combat. A casket can disappear visually while its old entity slot still
looks active in memory; exact targeting correctly rejects that stale state.
Do not spend repeated target attempts on a model that is no longer visible.

A later Walking Sapling victory spawned a fresh casket in the same server-ID
slot. Exact-ID interaction succeeded and exposed a temporary `Potion +1`.
The final `Obtain this temporary item?` query defaulted to `No`; the verified
accept sequence was one bounded `up` followed by `confirm`. This item-selection
state is observable through `selected_item`, but the highlighted Yes/No row is
not yet exposed, so a one-time visual check was used. A future casket helper
should encode the menu states and preserve exact-ID and bounded-input checks.

Two more fresh caskets exposed `Prism Powder`, `Echo Drops`, and `Antidote`.
For each temporary-item casket, the observed sequence was:

1. exact-ID casket interaction;
2. choose the non-`None` item row;
3. confirm the resource-backed `selected_item`;
4. advance to the final Yes/No query;
5. move from the default `No` to `Yes`; and
6. confirm and require an authoritative `obtains the temporary item` event.

This stable sequence is a candidate for a narrow casket macro/helper. The item
name must still be verified before the helper commits to the final query.

### Level-7 farming milestone

The resilient handoff completed three more committed fights without
per-stage operator evaluation:

- Vulture `17215663`: 160 EXP and a bird egg;
- Walking Sapling `17215661`: 160 EXP after the live same-ID retry above;
- Vulture `17215663`: 160 EXP and a bird feather; and
- Rock Lizard `17215659`: 180 EXP and Monk level 7.

The level-up changed the authoritative state from level 6 at 1,650/1,750 EXP
to level 7 at 80/2,000 EXP. Maximum HP rose from 108 to 123, attack from 33 to
34, and defense from 38 to 40. The client independently emitted
`Pablo attains level 7!`. The lizard fight ended at 9% HP; committed mode
correctly continued because retreat routing was not part of the selected
policy, and the level-up restored Pablo to full HP.

### Records of Eminence farming multiplier

The 2026 new-player guide used for this experiment prompted a narrow Records
of Eminence validation instead of a wholesale change to the progression plan.
The pinned LandSandBoat revision `2949f26b97fb80c775019955d66dd2954d1673a0`
has Records of Eminence enabled at 1.0 EXP and sparks rates. Its implemented
records include the tutorial objectives and the general combat counters used
below.

Pablo navigated to Isakoth in Bastok Markets at
`(-343.396, -171.542, -10.002)` using the existing navmesh runner. The initial
objective was set through bounded MCP menu pulses:

1. `Quests` -> `Objective List` -> `Tutorial` -> `Basics`;
2. activate `First Step Forward`;
3. close the menus and interact with exact server ID `17739953`; and
4. advance the guarded dialogue until the menu closed.

Screenshots were used only to read the highlighted menu row. Every navigation,
selection, confirmation, and interaction was sent through the private MCP
bridge. Authoritative events confirmed the first completion awarded 300 EXP,
300 sparks of eminence, six Meat Jerky, and the Memorandoll key item. Pablo
ended at Monk level 7 with 680/2,000 EXP and 300 sparks.

Only objectives that compound the existing farming loop were then activated:

- `Vanquish One Enemy`;
- `Vanquish Multiple Enemies I`;
- `Deal 10-20 Damage`;
- `Total Damage I`;
- `Total Damage Taken I`; and
- `Weapon Skills I`.

The current limited-time `Vanquish Beasts` challenge activated automatically.
This is the preferred boundary for the first pass: resume combat and movement
work now, let passive counters advance, and add spoils or ecosystem-specific
objectives only when they match the current camp.

The first live farming pass validated that boundary. The committed combat
helper defeated two Walking Saplings, two Vultures, and one Rock Lizard while
automatically using Combo at 1,000 TP. `Vanquish One Enemy` awarded its
first-time 300 sparks and 500 EXP after the first sapling. Ten qualifying
hits then completed `Deal 10-20 Damage`, awarding another 300 sparks and
2,500 EXP. The final Vulture's normal 130 EXP and that objective reward moved
Pablo directly from Monk level 7 at 1,750/2,000 EXP to level 9 at 129/2,400
EXP. The selected general combat objectives advanced without reopening the
quest menu.

This pass also established the movement fallback rule. Exact-ID target and
`/follow` should remain the fast path in open terrain. One Rock Lizard could
not be selected while it was about 30 yalms away; moving to a nearby open-field
coordinate made the same ID targetable at 12 yalms. A later Vulture follow
reported `no_progress` and timed out without attacking. A four-segment
navmesh route cleared that obstruction, after which the unchanged exact-ID
combat command completed the fight. Future orchestration should invoke that
bounded coordinate/navmesh fallback automatically after measured target-range
or no-progress failures, not poll the camera continuously.

Records of Eminence also creates a legitimate path to the 10,000-gil goal.
The live sparks shop prices an Acheron Shield at 2,755 sparks, while this
server's local `item_basic` table gives it a 27,550-gil base sell value. Pablo
now has 900 sparks and needs 1,855 more before that conversion is available.
Do not alter currency, teleport, or grant the item administratively; the
objective events and normal NPC exchange remain the gameplay authority.

## Provenance and licensing

- The Ashita `IAutoFollow` annotations are part of the official GPL-licensed
  [Ashita v4 repository](https://github.com/AshitaXI/Ashita-v4beta/blob/main/addons/libs/annotations/SDK/Memory/IAutoFollow.lua).
- LandSandBoat's official GPLv3
  [navmesh implementation](https://github.com/LandSandBoat/server/blob/base/src/map/navmesh/navmesh.cpp)
  documents the `MSET` loader, FFXI/Detour coordinate conversion, and Detour
  query parameters.
- The host uses the MIT-licensed
  [recast-navigation](https://github.com/isaac-mason/recast-navigation-js)
  package.

A separate public Ashita navigation experiment was useful architectural
evidence for combining world-vector movement with a host path planner, but it
does not declare a repository license. None of its implementation is vendored
or copied here.

## Remaining work

1. Detect zone changes as successful path termination and select the next mesh.
2. Resolve zone IDs to mesh filenames and export meshes on demand.
3. Persist temporarily blocked navmesh edges and route around them when another
   connected corridor exists; bounded replanning from the actual stop position
   is already implemented.
4. Hand a failed navmesh segment automatically to the collision-probe runner
   and feed successful probe nodes back into the route graph.
5. Persist quest interaction points as data rather than one-off coordinates.
6. Add a bounded loop that selects successive low-risk targets and returns to
   a safe location without embedding one-off entity IDs.

The first read-only part of item 6 is now implemented as `mcp:scout`. It joins
live MCP entity IDs to an ignored export of the matching LandSandBoat zone
metadata, ranks explainable candidates, and performs no writes. See
[addon-tooling.md](addon-tooling.md). Exact-ID `/check` remains mandatory.

Tunnel Worms also have a periodic burrow window in which an entity can remain
observable but the client refuses to select it. `mcp:check-target` accepts a
bounded `--targetability-timeout`; every failed attempt emergency-disarms
control before it waits. Use this before inferring collision or moving closer.
