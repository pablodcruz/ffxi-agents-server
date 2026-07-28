export const TRAVEL_CACHE_SCHEMA_VERSION = 1;

const exactTravelNodes = Object.freeze([
  {
    pattern: /^Home Point #[1-5]$/,
    type: "home_point",
    registrationMethod: "interact",
    safeAutoRegistration: true,
  },
  {
    pattern: /^Survival Guide$/,
    type: "survival_guide",
    registrationMethod: "interact",
    safeAutoRegistration: true,
  },
  {
    pattern: /^Waypoint$/,
    type: "waypoint",
    registrationMethod: "interact",
    safeAutoRegistration: true,
  },
  {
    pattern: /^Proto-Waypoint$/,
    type: "proto_waypoint",
    registrationMethod: "quest_or_key_item",
    safeAutoRegistration: false,
  },
  {
    pattern: /^Outpost Gate$/,
    type: "outpost",
    registrationMethod: "conquest_supply_quest",
    safeAutoRegistration: false,
  },
]);

function finitePosition(position) {
  if (
    !position
    || ![position.x, position.y, position.z].every(Number.isFinite)
  ) {
    return null;
  }
  return {
    x: Number(position.x),
    y: Number(position.y),
    z: Number(position.z),
  };
}

export function travelNodeKey({ agentId, zoneId, serverId }) {
  const parsedZoneId = Number(zoneId);
  const parsedServerId = Number(serverId);
  if (!agentId || !Number.isInteger(parsedZoneId) || !Number.isInteger(parsedServerId)) {
    throw new Error("Travel-node keys require agentId, zoneId, and serverId.");
  }
  return `${agentId}:${parsedZoneId}:${parsedServerId}`;
}

export function classifyTravelNode(entity) {
  const name = String(entity?.name || "").trim();
  const match = exactTravelNodes.find(({ pattern }) => pattern.test(name));
  if (!match) return null;
  return {
    type: match.type,
    registration_method: match.registrationMethod,
    safe_auto_registration: match.safeAutoRegistration,
  };
}

export function createTravelCache() {
  return {
    schema_version: TRAVEL_CACHE_SCHEMA_VERSION,
    updated_at: null,
    nodes: {},
  };
}

export function validateTravelCache(cache) {
  if (
    !cache
    || cache.schema_version !== TRAVEL_CACHE_SCHEMA_VERSION
    || !cache.nodes
    || typeof cache.nodes !== "object"
    || Array.isArray(cache.nodes)
  ) {
    throw new Error("Unsupported or invalid travel-node cache.");
  }
  return cache;
}

export function updateTravelCache(cache, {
  agentId,
  zoneId,
  observedAt,
  entities = [],
}) {
  validateTravelCache(cache);
  const timestamp = new Date(observedAt || Date.now()).toISOString();
  const discovered = [];

  for (const entity of entities) {
    const classification = classifyTravelNode(entity);
    const position = finitePosition(entity?.position);
    const serverId = Number(entity?.server_id);
    if (!classification || !position || !Number.isInteger(serverId)) continue;

    const key = travelNodeKey({ agentId, zoneId, serverId });
    const existing = cache.nodes[key];
    const node = {
      key,
      agent_id: agentId,
      zone_id: Number(zoneId),
      server_id: serverId,
      name: String(entity.name),
      ...classification,
      position,
      last_observed_distance: Number.isFinite(entity.distance)
        ? Number(entity.distance)
        : null,
      first_observed_at: existing?.first_observed_at || timestamp,
      last_observed_at: timestamp,
      registration_state: existing?.registration_state || "discovered",
      interaction_completed_at: existing?.interaction_completed_at || null,
      registered_at: existing?.registered_at || null,
      verification: existing?.verification || null,
    };
    cache.nodes[key] = node;
    discovered.push(node);
  }

  cache.updated_at = timestamp;
  return discovered;
}

export function markTravelNodeInteractionCompleted(cache, key, {
  completedAt = Date.now(),
} = {}) {
  validateTravelCache(cache);
  const node = cache.nodes[key];
  if (!node) throw new Error(`Unknown travel node: ${key}`);
  if (node.registration_state !== "registered") {
    node.registration_state = "interaction_completed";
    node.interaction_completed_at = new Date(completedAt).toISOString();
    cache.updated_at = node.interaction_completed_at;
  }
  return node;
}

export function markTravelNodeRegistered(cache, key, {
  verifiedAt = Date.now(),
  verification,
} = {}) {
  validateTravelCache(cache);
  const node = cache.nodes[key];
  if (!node) throw new Error(`Unknown travel node: ${key}`);
  if (!verification) {
    throw new Error("Registered travel nodes require an explicit verification source.");
  }
  node.registration_state = "registered";
  node.interaction_completed_at ||= new Date(verifiedAt).toISOString();
  node.registered_at = new Date(verifiedAt).toISOString();
  node.verification = String(verification);
  cache.updated_at = node.registered_at;
  return node;
}

export function registrationEvidence(node, events = [], { since = 0 } = {}) {
  const patterns = {
    home_point: /registered a new home point/i,
    survival_guide: /(?:registered|recorded|attuned).{0,40}survival guide|survival guide.{0,40}(?:registered|recorded|attuned)/i,
    waypoint: /waypoint.{0,40}attuned|attuned.{0,40}waypoint/i,
  };
  const pattern = patterns[node?.type];
  if (!pattern) return null;

  return events.find((event) => (
    Number(event?.timestamp) >= Number(since)
    && ![0, 1].includes(Number(event?.mode))
    && pattern.test(String(event?.message || ""))
  )) || null;
}

export function routeEligibleTravelNodes(cache, { agentId } = {}) {
  validateTravelCache(cache);
  return Object.values(cache.nodes)
    .filter((node) => (
      node.registration_state === "registered"
      && (!agentId || node.agent_id === agentId)
    ))
    .sort((left, right) => (
      left.zone_id - right.zone_id
      || left.name.localeCompare(right.name)
      || left.server_id - right.server_id
    ));
}
