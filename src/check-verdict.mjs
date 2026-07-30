const difficultyPatterns = Object.freeze([
  {
    pattern: /strength is impossible to gauge/i,
    difficulty: "impossible_to_gauge",
    verdict: "caution",
  },
  {
    pattern: /seems incredibly tough/i,
    difficulty: "incredibly_tough",
    verdict: "unsafe",
  },
  {
    pattern: /seems very tough/i,
    difficulty: "very_tough",
    verdict: "unsafe",
  },
  {
    pattern: /seems tough/i,
    difficulty: "tough",
    verdict: "unsafe",
  },
  {
    pattern: /seems (?:evenly matched|like an even match)/i,
    difficulty: "even_match",
    verdict: "unsafe",
  },
  {
    pattern: /seems like a decent challenge/i,
    difficulty: "decent_challenge",
    verdict: "caution",
  },
  {
    pattern: /seems like easy prey/i,
    difficulty: "easy_prey",
    verdict: "safe",
  },
  {
    pattern: /seems too weak/i,
    difficulty: "too_weak",
    verdict: "safe",
  },
]);

function normalizeMessage(message) {
  return String(message || "")
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCheckVerdict(events, { afterEventId = 0 } = {}) {
  const candidates = (events || [])
    .filter((event) => Number(event.id) > afterEventId)
    .sort((left, right) => Number(right.id) - Number(left.id));
  for (const event of candidates) {
    const message = normalizeMessage(event.message);
    const difficulty = difficultyPatterns.find(({ pattern }) => pattern.test(message));
    if (!difficulty) continue;
    return {
      event_id: Number(event.id),
      message,
      difficulty: difficulty.difficulty,
      verdict: difficulty.verdict,
      high_defense: /high defense/i.test(message),
      high_evasion: /high evasion/i.test(message),
    };
  }
  return {
    event_id: null,
    message: null,
    difficulty: "unknown",
    verdict: "unknown",
    high_defense: false,
    high_evasion: false,
  };
}
