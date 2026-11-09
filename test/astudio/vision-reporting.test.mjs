import assert from 'node:assert/strict';

import { test } from 'vitest';
import { chat } from '../../scripts/astudio/vision/chat.mjs';
import { forEachConcurrent } from '../../scripts/astudio/vision/concurrency.mjs';
import { bindReview } from '../../scripts/astudio/vision/judge.mjs';
import { candidateStatus } from '../../scripts/astudio/vision/live-provider.mjs';
import {
  buildReport,
  capabilityMetrics,
  summarize,
} from '../../scripts/astudio/vision/metrics.mjs';
import { estimateCost, normalizeUsage } from '../../scripts/astudio/vision/pricing.mjs';
import { DIMENSIONS } from '../../scripts/astudio/vision/score.mjs';

function record(id, earned, possible, score) {
  return {
    model_id: 'test/model',
    case_id: id,
    scene: 'canvas',
    applicable_points: Object.fromEntries(
      DIMENSIONS.map((dimension, index) => [dimension, index === 0 ? possible : 0]),
    ),
    annotation_count: 0,
    candidate: { status: 'ok', elapsed_ms: 2000 },
    cost: { amount: 0.1, usage: { input: 100, output: 20, total: 120 } },
    result: {
      score,
      dimensions: Object.fromEntries(
        DIMENSIONS.map((dimension, index) => [
          dimension,
          { earned: index === 0 ? earned : 0, possible: index === 0 ? possible : 0 },
        ]),
      ),
      annotation_complete_count: 0,
    },
  };
}

function snapshot(rules) {
  return {
    models: [{ id: 'test/model', name: '测试', pricing_rules: rules }],
    as_of: '2026-11-09T00:00:00Z',
    sources: ['https://example.com/pricing'],
  };
}
function rule(overrides = {}) {
  return {
    pricing_row_id: 1,
    provider_id: '',
    applies_to_provider_ids: ['provider-a'],
    billing_mode: 'on_demand',
    currency: 'CNY',
    region: 'cn',
    tier_key: 'default',
    tier_min_tokens: 0,
    tier_max_tokens: 0,
    rates: [
      {
        rate_key: 'static',
        rate_label: '固定价',
        is_default: true,
        windows: [],
        pricing: {
          input: '0.000002',
          output: '0.000004',
          cache: { read: '0.0000002', write_5m: '0.000005' },
        },
      },
    ],
    ...overrides,
  };
}
function usageRecord(overrides = {}) {
  return {
    model_id: 'test/model',
    provider: 'provider-a',
    started_at: '2026-11-09T08:00:00Z',
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 20, cache_creation_tokens: 10 },
    },
    ...overrides,
  };
}

test('overall score uses equal task weights and does not read scene labels', () => {
  const rows = [record('a', 1, 1, 100), record('b', 1, 9, 100 / 9)];
  assert.ok(Math.abs(summarize(rows).score - (100 + 100 / 9) / 2) < 1e-12);
  rows[0].scene = 'documents';
  assert.equal(summarize(rows).score, (100 + 100 / 9) / 2);
  rows.push(record('c', 0, 1, 0));
  assert.equal(summarize(rows).score, (100 + 100 / 9) / 3);
});

test('capability aggregation pools binary checkpoint counts, not task rates', () => {
  const metrics = capabilityMetrics([record('a', 1, 1, 100), record('b', 1, 9, 100 / 9)]);
  assert.equal(metrics[0].earned, 2);
  assert.equal(metrics[0].possible, 10);
  assert.equal(metrics[0].rate, 0.2);
  assert.equal(metrics[1].rate, null);
});

test('annotation completeness pools annotations and keeps other skills separate', () => {
  const a = record('a', 1, 1, 100),
    b = record('b', 1, 1, 100);
  a.annotation_count = 1;
  b.annotation_count = 4;
  a.result.annotation_complete_count = b.result.annotation_complete_count = 1;
  const metric = capabilityMetrics([a, b]).at(-1);
  assert.equal(metric.possible, 5);
  assert.equal(metric.earned, 2);
  assert.equal(metric.rate, 0.4);
});

test('pending judgments preserve planned denominators and leave quality unavailable', () => {
  const a = record('a', 1, 1, 100),
    b = record('b', 1, 9, 100 / 9);
  b.result = null;
  assert.equal(summarize([a, b]).score, null);
  assert.equal(summarize([a, b]).planned, 2);
  assert.equal(summarize([a, b]).pending_judgments, 1);
  assert.equal(capabilityMetrics([a, b])[0].possible, 10);
  assert.equal(capabilityMetrics([a, b])[0].rate, null);
});

test('parameter and authorization failures are configuration errors, not ability zeros', () => {
  assert.equal(
    candidateStatus({ http_status: 401, error: 'unauthorized', output: '' }),
    'invalid_configuration',
  );
  assert.equal(
    candidateStatus({
      http_status: 503,
      error_code: 'model_not_found',
      error: 'missing model',
      output: '',
    }),
    'invalid_configuration',
  );
  assert.equal(candidateStatus({ http_status: 504, error: 'timeout', output: '' }), 'error');
  const row = record('a', 1, 1, 100);
  row.candidate.status = 'invalid_configuration';
  row.result = null;
  assert.equal(summarize([row]).score, null);
  assert.equal(summarize([row]).invalid_configuration_calls, 1);
});

test('unknown token and monetary usage remain unavailable while real zeros survive', () => {
  const a = record('a', 0, 1, 0);
  a.cost = { amount: null, usage: normalizeUsage(null) };
  assert.equal(summarize([a]).input_tokens, null);
  assert.equal(summarize([a]).estimated_cost, null);
  a.cost = {
    amount: 0,
    usage: normalizeUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
  };
  assert.equal(summarize([a]).estimated_cost, 0);
  assert.equal(summarize([a]).total_tokens, 0);
});

test('cache read and creation are removed from ordinary input before costing', () => {
  const result = estimateCost(snapshot([rule()]), usageRecord());
  assert.ok(Math.abs(result.amount - (70 * 2 + 20 * 0.2 + 10 * 5 + 50 * 4) / 1e6) < 1e-15);
});

test('missing used cache price and impossible cache totals cannot become a free cost', () => {
  const missing = rule();
  delete missing.rates[0].pricing.cache.read;
  assert.equal(estimateCost(snapshot([missing]), usageRecord()).amount, null);
  const bad = usageRecord();
  bad.usage.prompt_tokens_details.cached_tokens = 200;
  assert.equal(estimateCost(snapshot([rule()]), bad).amount, null);
});

test('ambiguous provider prices are unavailable instead of silently using the cheapest', () => {
  const rules = [rule(), rule({ pricing_row_id: 2, applies_to_provider_ids: ['provider-b'] })];
  assert.equal(estimateCost(snapshot(rules), usageRecord({ provider: null })).amount, null);
});

test('time prices use the request timestamp and an exclusive window end', () => {
  const base = rule();
  base.rates = [
    {
      rate_key: 'off',
      rate_label: '闲时',
      is_default: true,
      windows: [],
      pricing: { input: '0.000001', output: '0.000004' },
    },
    {
      rate_key: 'peak',
      rate_label: '忙时',
      is_default: false,
      windows: [{ start: '09:00', end: '18:00' }],
      pricing: { input: '0.000002', output: '0.000008' },
    },
  ];
  const usage = { prompt_tokens: 100, completion_tokens: 50 };
  assert.equal(
    estimateCost(snapshot([base]), usageRecord({ usage, started_at: '2026-11-09T09:59:00Z' }))
      .rate_key,
    'peak',
  );
  assert.equal(
    estimateCost(snapshot([base]), usageRecord({ usage, started_at: '2026-11-09T10:00:00Z' }))
      .rate_key,
    'off',
  );
});

test('tier selection respects input-token boundaries', () => {
  const low = rule({ tier_max_tokens: 100 });
  const high = rule({ pricing_row_id: 2, tier_min_tokens: 101 });
  assert.equal(estimateCost(snapshot([low, high]), usageRecord()).pricing_row_id, 1);
  const next = usageRecord();
  next.usage.prompt_tokens = 101;
  assert.equal(estimateCost(snapshot([low, high]), next).pricing_row_id, 2);
});

test('transport redacts the credential from upstream errors', async () => {
  const result = await chat({
    baseUrl: 'https://example.com/v1',
    model: 'test/model',
    apiKey: 'unit-test-secret',
    messages: [],
    fetcher: async () =>
      new Response(JSON.stringify({ error: 'invalid unit-test-secret' }), { status: 401 }),
  });
  assert.equal(result.http_status, 401);
  assert.equal(result.error.includes('unit-test-secret'), false);
  assert.ok(result.error.includes('[REDACTED]'));
});

test('bounded workers overlap and wait for all active workers before reporting errors', async () => {
  let active = 0,
    peak = 0,
    done = 0;
  await forEachConcurrent([1, 2, 3, 4], 2, async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    done++;
  });
  assert.equal(peak, 2);
  assert.equal(done, 4);
  let settled = false;
  await assert.rejects(
    forEachConcurrent([0, 1], 2, async (id) => {
      if (!id) {
        throw new Error('expected');
      }
      await Promise.resolve();
      settled = true;
    }),
    AggregateError,
  );
  assert.equal(settled, true);
});

test('a session review must bind the exact output, Gold, and complete binary checkpoint set', () => {
  const request = {
    case_id: 'a',
    answer_sha256: 'answer',
    gold_sha256: 'gold',
    checkpoints: [{ id: 'q.1', dimension: '文字识别', expected: '文本' }],
  };
  const decision = {
    case_id: 'a',
    answer_sha256: 'answer',
    gold_sha256: 'gold',
    checkpoints: [{ id: 'q.1', credit: 1, reason: '回答与原图一致' }],
    extra_edits: [],
  };
  assert.equal(bindReview(request, decision).checkpoints[0].dimension, '文字识别');
  assert.throws(() => bindReview(request, { ...decision, answer_sha256: 'old-answer' }), /哈希/);
  assert.throws(() => bindReview(request, { ...decision, checkpoints: [] }), /不完整/);
  assert.throws(
    () =>
      bindReview(request, {
        ...decision,
        checkpoints: [{ id: 'q.1', credit: 0.5, reason: 'partial' }],
      }),
    /二值/,
  );
});

test('the report rejects duplicates and out-of-plan results', () => {
  const config = { metrics_source: 'metrics', source: 'models' };
  const manifest = {
    models: [{ id: 'test/model', name: '测试' }],
    case_ids: ['a', 'b'],
    scenes: [{ id: 'canvas', name: '画布' }],
  };
  const a = record('a', 1, 1, 100),
    b = record('b', 1, 9, 100 / 9);
  const report = buildReport({ manifest, config, pricing: snapshot([]), records: [a, b] });
  assert.equal(report.capabilities[0].rate, 0.2);
  assert.throws(
    () => buildReport({ manifest, config, pricing: snapshot([]), records: [a, a] }),
    /重复结果/,
  );
  assert.throws(
    () =>
      buildReport({
        manifest,
        config,
        pricing: snapshot([]),
        records: [a, { ...b, case_id: 'c' }],
      }),
    /计划外/,
  );
});
