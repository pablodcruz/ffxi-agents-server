# Navigation

Status: world-coordinate movement validated; navmesh routing prototype validated;
tight-corner clearance recovery in progress.

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
earlier visual guess that the bridge entrance was south. The runner completed
the first two points and stopped safely 2.95 yalms from a tight third corner.
The next implementation step is clearance-aware corner recovery (wall-normal
offset or Detour Crowd sampling), not a return to camera steering.

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

1. Add clearance-aware corner recovery and rerun the Nbu route.
2. Resolve zone IDs to mesh filenames and export meshes on demand.
3. Add dynamic-obstacle recovery and bounded replanning.
4. Record zone transitions and interaction points for multi-zone quests.
5. Treat combat positioning as a separate policy on top of the same navigator.
