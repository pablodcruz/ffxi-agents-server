import assert from "node:assert/strict";
import test from "node:test";
import {
  agentUsageOverlayText,
  compactTokenRate,
  recordUsageSample,
  summarizeDailyUsage,
} from "../src/agent-usage-telemetry.mjs";

test("daily usage average is rounded to a stable thousand-token rate", () => {
  const start = Date.parse("2026-07-30T14:00:00-04:00");
  let state = recordUsageSample({}, {
    cumulativeTokens: 1_000_000,
    sampledAtMs: start,
    model: "ChatGPT 5.6 Sol",
  });
  state = recordUsageSample(state, {
    cumulativeTokens: 1_125_400,
    sampledAtMs: start + 30 * 60 * 1000,
    model: "ChatGPT 5.6 Sol",
  });
  const summary = summarizeDailyUsage(state, {
    nowMs: start + 30 * 60 * 1000,
  });
  assert.equal(summary.tokens_per_hour, 251_000);
  assert.equal(
    agentUsageOverlayText(summary),
    "AI CHATGPT 5.6 SOL | ~251K TOKENS/H TODAY",
  );
});

test("a single or too-recent sample reports collecting instead of a fake rate", () => {
  const start = Date.parse("2026-07-30T14:00:00-04:00");
  const state = recordUsageSample({}, {
    cumulativeTokens: 1_000_000,
    sampledAtMs: start,
  });
  const summary = summarizeDailyUsage(state, { nowMs: start });
  assert.equal(summary.tokens_per_hour, null);
  assert.match(agentUsageOverlayText(summary), /TOKENS\/H COLLECTING$/);
});

test("daily average ignores samples from the prior local day", () => {
  const prior = Date.parse("2026-07-29T23:55:00-04:00");
  let state = recordUsageSample({}, {
    cumulativeTokens: 900_000,
    sampledAtMs: prior,
  });
  state = recordUsageSample(state, {
    cumulativeTokens: 1_000_000,
    sampledAtMs: Date.parse("2026-07-30T00:05:00-04:00"),
  });
  const summary = summarizeDailyUsage(state, {
    nowMs: Date.parse("2026-07-30T00:05:00-04:00"),
  });
  assert.equal(summary.sample_count, 1);
  assert.equal(summary.tokens_per_hour, null);
});

test("compact token rates stay short enough for the in-game overlay", () => {
  assert.equal(compactTokenRate(251_000), "251K");
  assert.equal(compactTokenRate(1_250_000), "1.3M");
});
