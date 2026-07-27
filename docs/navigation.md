# Navigation

Status: world-coordinate movement, navmesh routing, NPC interaction, and a
multi-zone transition are validated; bounded combat validation is in progress.

## Why camera input is not the navigation layer

FFXI's normal forward key is camera-relative. It is useful for a manual fallback
or an input-bridge test, but it is too brittle for autonomous questing. Camera
pan, frame timing, and collision geometry should not be part of the agent's
route-planning contract.

Ashita's official `IAutoFollow` interface exposes `FollowDeltaX` and
`FollowDeltaY`. AgentBridge 0.9.0 normalizes the vector from the character's
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

Copy the outdoor mesh in the same way:

```sh
docker cp \
  ffxi-agent-lab-map-1:/server/navmeshes/South_Gustaberg.nav \
  runtime/navmeshes/South_Gustaberg.nav
```

South Gustaberg navigation then moved Pablo to less than 11 yalms from a Huge
Hornet without using the camera.

## Bounded combat

`mcp:combat` composes existing narrow MCP tools rather than expanding the
bridge protocol. It:

- selects one exact nearby entity;
- approaches it with a leased entity-follow movement;
- refuses to attack outside the configured range;
- sends only `/attack <t>`;
- samples player and target HP once per second;
- stops at a configurable player-HP floor, target defeat, logout, or timeout;
- sends `/attackoff`; and
- always invokes the emergency stop before exit.

Example:

```sh
pnpm mcp:combat -- \
  --target "Huge Hornet" \
  --max-start-distance 25 \
  --minimum-hp-percent 40 \
  --combat-timeout 90
```

The first live invocation failed closed before sending `/attack` because the
map server had already been terminated by its two-second inactivity watchdog.
The QEMU-safe watchdog configuration and recovery are documented in
[troubleshooting.md](troubleshooting.md).

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
3. Add dynamic-obstacle recovery and bounded replanning.
4. Persist quest interaction points as data rather than one-off coordinates.
5. Validate bounded combat through level 2 and add recovery/target selection
   policy for repeated encounters.
