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

`mcp:combat` composes existing narrow MCP tools rather than expanding the
bridge protocol. It:

- selects one exact nearby entity;
- rests to a configurable minimum starting HP when necessary;
- approaches it with a leased entity-follow movement;
- refuses to attack outside the configured range;
- reacquires and verifies the exact server ID after movement;
- sends only `/attack <t>`;
- samples player and target HP once per second;
- stops at a configurable player-HP floor, target defeat, logout, or timeout;
- sends `/attackoff`; and
- always invokes the emergency stop before exit.

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

Use `--server-id` when multiple nearby entities share the same display name.
The ID comes from `ffxi_observe`; the bridge still validates that the entity is
nearby before targeting it. AgentBridge 0.9.1 makes an explicit server ID
authoritative; name matching is only a fallback when no ID is supplied. This
fixed an ambiguity where a corpse or a different live Huge Hornet could be
selected because several entities shared the same name.

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
