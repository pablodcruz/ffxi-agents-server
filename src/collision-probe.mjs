import fs from "node:fs";
import path from "node:path";
import { distance2d } from "./navmesh-planner.mjs";

const angleOffsets = Object.freeze([
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  3 * Math.PI / 4,
  -3 * Math.PI / 4,
  Math.PI,
]);

function finitePosition(position) {
  return position
    && Number.isFinite(position.x)
    && Number.isFinite(position.y);
}

function nearAny(position, positions, radius) {
  return positions.some((candidate) => (
    finitePosition(candidate) && distance2d(position, candidate) < radius
  ));
}

export function classifyProbe({
  start,
  target,
  end,
  stopDistance = 1,
  minimumProgress = 1,
}) {
  const requestedDistance = distance2d(start, target);
  const displacement = distance2d(start, end);
  const remaining = distance2d(end, target);
  let outcome = "stalled";
  if (remaining <= stopDistance) {
    outcome = "arrived";
  } else if (displacement >= minimumProgress) {
    outcome = "partial_progress";
  }
  return {
    outcome,
    requested_distance: requestedDistance,
    displacement,
    remaining,
  };
}

export function withinArrivalDistance(position, destination, arrivalDistance = 2) {
  return finitePosition(position)
    && finitePosition(destination)
    && distance2d(position, destination) <= arrivalDistance;
}

export function collisionEvidence(entries, { destination, destinationRadius = 3 } = {}) {
  const sameDestination = (entry) => (
    !destination
    || (
      finitePosition(entry.destination)
      && distance2d(entry.destination, destination) <= destinationRadius
    )
  );
  return {
    visited: entries
      .filter((entry) => entry.outcome !== "stalled" && sameDestination(entry))
      .map((entry) => entry.end),
    failedTargets: entries
      .filter((entry) => entry.outcome !== "arrived")
      .map((entry) => entry.target),
  };
}

export function generateProbeCandidates({
  position,
  destination,
  stepDistance = 6,
  visited = [],
  failedTargets = [],
  entities = [],
  minimumEntityDistance = 12,
  candidateSeparation = 2,
}) {
  if (!finitePosition(position) || !finitePosition(destination)) {
    throw new Error("Probe candidate generation requires finite positions.");
  }
  if (!Number.isFinite(stepDistance) || stepDistance < 2 || stepDistance > 12) {
    throw new Error("Probe step distance must be from 2 through 12.");
  }

  const goalAngle = Math.atan2(
    destination.y - position.y,
    destination.x - position.x,
  );
  return angleOffsets
    .map((offset, preference) => {
      const angle = goalAngle + offset;
      const waypoint = {
        x: position.x + (Math.cos(angle) * stepDistance),
        y: position.y + (Math.sin(angle) * stepDistance),
      };
      const nearestEntity = entities.reduce(
        (nearest, entity) => Math.min(
          nearest,
          finitePosition(entity?.position)
            ? distance2d(waypoint, entity.position)
            : Number.POSITIVE_INFINITY,
        ),
        Number.POSITIVE_INFINITY,
      );
      return {
        waypoint,
        angle,
        preference,
        destination_distance: distance2d(waypoint, destination),
        nearest_entity_distance: nearestEntity,
      };
    })
    .filter(({ waypoint, nearest_entity_distance }) => (
      nearest_entity_distance >= minimumEntityDistance
      && !nearAny(waypoint, visited, candidateSeparation)
      && !nearAny(waypoint, failedTargets, candidateSeparation)
    ))
    .sort((left, right) => (
      left.preference - right.preference
      || left.destination_distance - right.destination_distance
    ));
}

export class CollisionProbeLog {
  constructor({
    filePath = path.join(
      process.cwd(),
      "runtime",
      "navigation",
      "collision-probes.jsonl",
    ),
    clock = () => new Date(),
  } = {}) {
    this.filePath = filePath;
    this.clock = clock;
  }

  append(record) {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(directory, 0o700);

    const entry = {
      timestamp: this.clock().toISOString(),
      mesh: String(record.mesh || "").slice(0, 128),
      agent_id: String(record.agent_id || "primary").slice(0, 32),
      destination: record.destination,
      start: record.start,
      target: record.target,
      end: record.end,
      outcome: record.outcome,
      requested_distance: record.requested_distance,
      displacement: record.displacement,
      remaining: record.remaining,
      hp_percent: record.hp_percent,
    };
    const descriptor = fs.openSync(
      this.filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY,
      0o600,
    );
    try {
      fs.writeSync(descriptor, `${JSON.stringify(entry)}\n`);
    } finally {
      fs.closeSync(descriptor);
    }
    if (process.platform !== "win32") fs.chmodSync(this.filePath, 0o600);
    return entry;
  }

  read({ limit = 200, mesh } = {}) {
    if (!fs.existsSync(this.filePath)) return [];
    const entries = fs.readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return entries
      .filter((entry) => !mesh || entry.mesh === mesh)
      .slice(-Math.max(1, Math.min(1000, limit)));
  }
}
