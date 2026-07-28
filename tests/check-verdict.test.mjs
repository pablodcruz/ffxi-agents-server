import assert from "node:assert/strict";
import test from "node:test";
import { parseCheckVerdict } from "../src/check-verdict.mjs";

test("parses safe, caution, and unsafe check messages", () => {
  assert.equal(parseCheckVerdict([
    { id: 1, message: "The Huge Hornet seems like easy prey." },
  ]).verdict, "safe");
  assert.equal(parseCheckVerdict([
    { id: 2, message: "The Ding Bats seems like a decent challenge." },
  ]).verdict, "caution");
  assert.deepEqual(parseCheckVerdict([
    {
      id: 3,
      message: "The Vulture seems like an even match.\u0007It seems to have high defense.\u007f1",
    },
  ]), {
    event_id: 3,
    message: "The Vulture seems like an even match. It seems to have high defense. 1",
    difficulty: "even_match",
    verdict: "unsafe",
    high_defense: true,
    high_evasion: false,
  });
  assert.deepEqual(parseCheckVerdict([
    {
      id: 4,
      message: "The Stone Eater seems tough.\u0007It seems to have high defense.\u007f1",
    },
  ]), {
    event_id: 4,
    message: "The Stone Eater seems tough. It seems to have high defense. 1",
    difficulty: "tough",
    verdict: "unsafe",
    high_defense: true,
    high_evasion: false,
  });
});

test("ignores stale and unrelated events", () => {
  assert.deepEqual(parseCheckVerdict([
    { id: 4, message: "The Huge Hornet seems like easy prey." },
    { id: 5, message: "Agent control explicitly enabled." },
  ], { afterEventId: 4 }), {
    event_id: null,
    message: null,
    difficulty: "unknown",
    verdict: "unknown",
    high_defense: false,
    high_evasion: false,
  });
});
