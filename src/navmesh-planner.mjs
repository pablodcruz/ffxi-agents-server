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
  query.destroy();
  navMesh.destroy();
  return path;
}
