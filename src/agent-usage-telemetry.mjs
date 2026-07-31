const DEFAULT_MODEL = "ChatGPT 5.6 Sol";
const MINIMUM_RATE_WINDOW_MS = 5 * 60 * 1000;
const RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

function finiteNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function normalizeModelLabel(value) {
  const label = String(value || DEFAULT_MODEL).trim();
  if (
    !label
    || label.length > 40
    || /[\r\n|]/.test(label)
  ) {
    throw new Error("Model label must be a single line up to 40 characters.");
  }
  return label;
}

export function localDayKey(timestampMs, timeZone = "America/New_York") {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Usage sample timestamp must be valid.");
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function recordUsageSample(
  state,
  {
    cumulativeTokens,
    sampledAtMs = Date.now(),
    model = DEFAULT_MODEL,
  },
) {
  const tokens = finiteNonNegativeInteger(cumulativeTokens);
  if (tokens === null) {
    throw new Error("Cumulative tokens must be a non-negative integer.");
  }
  if (!Number.isFinite(sampledAtMs)) {
    throw new Error("Usage sample timestamp must be finite.");
  }
  const normalizedModel = normalizeModelLabel(model);
  const priorSamples = Array.isArray(state?.samples) ? state.samples : [];
  const samples = priorSamples
    .map((sample) => ({
      sampled_at_ms: Number(sample?.sampled_at_ms),
      cumulative_tokens: finiteNonNegativeInteger(sample?.cumulative_tokens),
    }))
    .filter((sample) => (
      Number.isFinite(sample.sampled_at_ms)
      && sample.cumulative_tokens !== null
      && sample.sampled_at_ms >= sampledAtMs - RETENTION_MS
      && sample.sampled_at_ms !== sampledAtMs
    ));
  samples.push({
    sampled_at_ms: sampledAtMs,
    cumulative_tokens: tokens,
  });
  samples.sort((left, right) => left.sampled_at_ms - right.sampled_at_ms);
  return {
    schema_version: 1,
    model: normalizedModel,
    samples,
  };
}

export function summarizeDailyUsage(
  state,
  {
    nowMs = Date.now(),
    timeZone = "America/New_York",
  } = {},
) {
  const model = normalizeModelLabel(state?.model);
  const samples = (Array.isArray(state?.samples) ? state.samples : [])
    .map((sample) => ({
      sampled_at_ms: Number(sample?.sampled_at_ms),
      cumulative_tokens: finiteNonNegativeInteger(sample?.cumulative_tokens),
    }))
    .filter((sample) => (
      Number.isFinite(sample.sampled_at_ms)
      && sample.cumulative_tokens !== null
      && sample.sampled_at_ms <= nowMs
      && localDayKey(sample.sampled_at_ms, timeZone)
        === localDayKey(nowMs, timeZone)
    ))
    .sort((left, right) => left.sampled_at_ms - right.sampled_at_ms);

  if (samples.length < 2) {
    return { model, tokens_per_hour: null, sample_count: samples.length };
  }

  const latest = samples.at(-1);
  let baseline = samples[0];
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].cumulative_tokens < samples[index - 1].cumulative_tokens) {
      baseline = samples[index];
    }
  }
  const elapsedMs = latest.sampled_at_ms - baseline.sampled_at_ms;
  const tokenDelta = latest.cumulative_tokens - baseline.cumulative_tokens;
  if (elapsedMs < MINIMUM_RATE_WINDOW_MS || tokenDelta < 0) {
    return { model, tokens_per_hour: null, sample_count: samples.length };
  }
  const rawRate = tokenDelta / (elapsedMs / (60 * 60 * 1000));
  return {
    model,
    tokens_per_hour: Math.round(rawRate / 1000) * 1000,
    sample_count: samples.length,
  };
}

export function compactTokenRate(value) {
  const rate = finiteNonNegativeInteger(value);
  if (rate === null) return null;
  if (rate >= 1_000_000) {
    return `${(rate / 1_000_000).toFixed(rate >= 10_000_000 ? 0 : 1)}M`;
  }
  if (rate >= 1_000) return `${Math.round(rate / 1_000)}K`;
  return String(rate);
}

export function agentUsageOverlayText(summary) {
  const model = normalizeModelLabel(summary?.model);
  const rate = compactTokenRate(summary?.tokens_per_hour);
  return rate
    ? `AI ${model.toUpperCase()} | ~${rate} TOKENS/H TODAY`
    : `AI ${model.toUpperCase()} | TOKENS/H COLLECTING`;
}
