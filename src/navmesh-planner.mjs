import fs from "node:fs/promises";
import { NavMeshQuery, importNavMesh, init } from "recast-navigation";

const queryHalfExtents = Object.freeze({ x: 2.5, y: 5, z: 2.5 });

export function ffxiToDetour(position) {
  return {
    x: position.x,
    y: -position.z,
    z: -position.y,
  };
}

export function detourToFfxi(position) {
  return {
    x: position.x,
    y: -position.z,
    z: -position.y,
  };
}

export function distance2d(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function subdividePath(path, maximumSegmentDistance = 20) {
  if (!Number.isFinite(maximumSegmentDistance) || maximumSegmentDistance <= 0) {
    throw new Error("maximumSegmentDistance must be a positive finite number.");
  }
  if (!Array.isArray(path) || path.length < 2) {
    return Array.isArray(path) ? [...path] : [];
  }

  const subdivided = [{ ...path[0] }];
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentDistance = distance2d(start, end);
    const parts = Math.max(1, Math.ceil(segmentDistance / maximumSegmentDistance));
    for (let part = 1; part <= parts; part += 1) {
      const ratio = part / parts;
      subdivided.push({
        x: start.x + ((end.x - start.x) * ratio),
        y: start.y + ((end.y - start.y) * ratio),
        z: start.z + ((end.z - start.z) * ratio),
      });
    }
  }
  return subdivided;
}

export function reachesDestination(path, destination, maximumDistance = 3) {
  const finalPoint = path.at(-1);
  return Boolean(finalPoint)
    && distance2d(finalPoint, destination) <= maximumDistance;
}

export async function planNavmeshPath({ meshPath, start, end }) {
  await init();
  const bytes = new Uint8Array(await fs.readFile(meshPath));
  const { navMesh } = importNavMesh(bytes);
  const query = new NavMeshQuery(navMesh, { maxNodes: 2048 });
  const result = query.computePath(
    ffxiToDetour(start),
    ffxiToDetour(end),
    {
      halfExtents: queryHalfExtents,
      maxPathPolys: 512,
      maxStraightPathPoints: 512,
    },
  );

  if (!result.success || result.path.length < 2) {
    query.destroy();
    navMesh.destroy();
    throw new Error(result.error?.name || "Navmesh did not return a usable path.");
  }

  const path = result.path.map(detourToFfxi);
  if (!reachesDestination(path, end)) {
    query.destroy();
    navMesh.destroy();
    throw new Error(
      "Navmesh returned only a partial path to the edge of a disconnected corridor.",
    );
  }
  query.destroy();
  navMesh.destroy();
  return path;
}
