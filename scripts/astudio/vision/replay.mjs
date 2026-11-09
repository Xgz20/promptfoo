import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { aggregate, compare } from './aggregate.mjs';
import { bytes, fixtureFor, hash, LOCAL, REPO, ROOT, read } from './files.mjs';
import { blockNetwork } from './offline.mjs';
import { SCORING_POLICY } from './policy.mjs';

const config = read('promptfooconfig.json');
Object.assign(process.env, config.env, {
  PROMPTFOO_CONFIG_DIR: path.join(LOCAL, 'promptfoo'),
  LOG_LEVEL: 'error',
});
const audit = blockNetwork();
const dataset = read('manifest.json');
assert.equal(hash(bytes('cases.jsonl')), dataset.cases_sha256);
const cases = bytes('cases.jsonl').toString('utf8').trim().split('\n').map(JSON.parse);
assert.equal(cases.length, 100);
assert.equal(new Set(cases.map((t) => t.metadata.case_id)).size, 100);
const references = JSON.parse(fs.readFileSync(path.join(LOCAL, 'reference-manifest.json'), 'utf8'));
let verifiedFiles = 0;
for (const source of dataset.sources) {
  for (const f of source.files) {
    assert.equal(hash(bytes(f.export_path)), f.sha256, 'Exported file changed: ' + f.export_path);
    verifiedFiles++;
  }
}
for (const scene of dataset.scenes) {
  assert.equal(hash(bytes(scene.manifest_path)), scene.manifest_sha256);
}

// The SDK itself opens cases.jsonl, expands local file vars, loads our provider,
// renders the actual multimodal message and invokes the custom assertion.
const { default: promptfoo } = await import('../../../src/index.ts');
const evaluation = await promptfoo.evaluate(
  { ...config, basePath: ROOT, writeLatestResults: false },
  { ...config.evaluateOptions, showProgressBar: false },
);
const summary = await evaluation.toEvaluateSummary();
const results = summary.results;
assert.equal(results.length, 200, 'Expected 100 tests × 2 historical providers');
const failures = [],
  taskDiffs = [],
  compact = [],
  byModel = {},
  expectedByModel = {},
  legacyByModel = {};
function findResult(grade) {
  if (grade?.metadata?.vision_result) {
    return grade.metadata.vision_result;
  }
  return grade?.componentResults?.map(findResult).find(Boolean);
}
const comparedFields = [
  'fully_correct',
  'dimensions',
  'geometry',
  'answer_sha256',
  'gold_sha256',
  'status',
  'schema_valid',
  'parse_method',
  'id_sets_complete',
  'field_roles_valid',
  'extra_edit_penalty',
  'annotation_outcomes',
  'annotation_complete_count',
  'annotation_total',
  'annotation_complete_rate_percent',
];
for (const row of results) {
  const result = findResult(row.gradingResult);
  if (!result) {
    failures.push({
      provider: row.provider?.id,
      case_id: row.testCase?.metadata?.case_id,
      error: row.error ?? row.gradingResult?.reason,
    });
    continue;
  }
  const meta = row.response.metadata,
    history = meta.history_key;
  assert.ok(['deepseek', 'sol'].includes(history));
  assert.equal(meta.input_verified, true);
  assert.equal(meta.replay_only, true);
  assert.equal(row.provider.id, `history:${history}`);
  const f = fixtureFor(history, result.taskId);
  // Re-check the oracle against the unmodified pre-integration report, not just
  // a copied expected score in replay-data.
  const originalReportBytes = fs.readFileSync(
    path.join(LOCAL, 'references', references.reports[f.source_report]),
  );
  assert.equal(hash(originalReportBytes), f.source_report_sha256);
  const oracle = JSON.parse(originalReportBytes).results.find((r) => r.taskId === result.taskId);
  assert.deepEqual(f.expected, oracle);
  assert.equal(hash(row.response.output), f.answer_sha256, 'Framework altered raw answer');
  const diffs = [];
  for (const k of comparedFields) {
    if (k in oracle) {
      compare(result[k], oracle[k], k, diffs);
    }
  }
  // Independent arithmetic from the frozen pre-change report. Do not call the
  // active scorer to construct its own expected result. Old totals are retained
  // as a comparison, while all atomic decisions must still match exactly.
  const oracleDimensions = Object.values(oracle.dimensions);
  const earnedPoints = oracleDimensions.reduce((n, d) => n + d.earned, 0);
  const totalPoints = oracleDimensions.reduce((n, d) => n + d.possible, 0);
  const pointBase = (100 * earnedPoints) / totalPoints;
  const pointScore = Math.max(0, pointBase - (oracle.extra_edit_penalty ?? 0));
  compare(
    result,
    {
      scoring_version: SCORING_POLICY.version,
      scoring_method: 'equal_applicable_points',
      earned_points: earnedPoints,
      total_points: totalPoints,
      base_score: pointBase,
      score: pointScore,
    },
    'point_mean',
    diffs,
  );
  compare(row.score, pointScore / 100, 'promptfoo.score', diffs);
  compare(row.success, oracle.fully_correct, 'promptfoo.success', diffs);
  for (const [dimension, d] of Object.entries(oracle.dimensions)) {
    if (d.applicable) {
      compare(
        row.namedScores?.[dimension] ?? row.gradingResult?.namedScores?.[dimension],
        d.rate,
        `promptfoo.namedScores.${dimension}`,
        diffs,
      );
    }
  }
  const caseMeta = cases.find((t) => t.metadata.case_id === result.taskId).metadata;
  (byModel[history] ??= []).push(result);
  (legacyByModel[history] ??= []).push({ ...oracle, scene: caseMeta.scene });
  (expectedByModel[history] ??= []).push({
    ...oracle,
    scene: caseMeta.scene,
    score: pointScore,
    base_score: pointBase,
  });
  taskDiffs.push({
    history,
    case_id: result.taskId,
    before: oracle.score,
    after: result.score,
    expected: pointScore,
    earned_points: earnedPoints,
    total_points: totalPoints,
    differences: diffs,
  });
  compact.push({ history, provider: row.provider.id, ...result });
}
fs.mkdirSync(path.join(LOCAL), { recursive: true });
fs.writeFileSync(
  path.join(LOCAL, 'framework-diagnostics.json'),
  JSON.stringify({ failures, taskDiffs }, null, 2) + '\n',
);
assert.equal(
  failures.length,
  0,
  `Framework errors: ${failures.length}; see .local/vision-astudio-v1/framework-diagnostics.json`,
);
const aggregates = {};
const historyManifest = JSON.parse(
  fs.readFileSync(path.join(LOCAL, 'replay-data/manifest.json'), 'utf8'),
);
const publishedBytes = fs.readFileSync(path.join(LOCAL, 'references/summary.json'));
assert.equal(hash(publishedBytes), historyManifest.published_summary_sha256);
const published = JSON.parse(publishedBytes);
for (const history of ['deepseek', 'sol']) {
  const after = aggregate(byModel[history], dataset.scenes),
    before = aggregate(legacyByModel[history], dataset.scenes),
    expected = aggregate(expectedByModel[history], dataset.scenes);
  const old = published.aggregates[history];
  const differences = compare(after, expected);
  compare(
    before,
    {
      score: old.score,
      task_mean_score: old.task_mean_score_secondary,
      task_count: old.task_count,
      fully_correct: old.fully_correct_tasks,
      annotation_complete: old.annotation_complete_count,
      annotation_total: old.annotation_total,
      annotation_complete_rate: old.annotation_complete_rate,
      semantic_correct: old.semantic_correct,
      semantic_total: old.semantic_total,
      dimensions: Object.fromEntries(
        Object.entries(old.dimensions).map(([d, r]) => [
          d,
          { applicable_task_count: r.applicable_tasks, rate: r.rate },
        ]),
      ),
    },
    'published_summary',
    differences,
  );
  for (const s of before.scenes) {
    const oldScene = published.items.find((item) => item.slug === s.id)[`${history}_metrics`];
    compare(
      s,
      {
        score: oldScene.score,
        fully_correct: oldScene.fully_correct_tasks,
        geometry_hits: oldScene.geometry_hits,
        geometry_total: oldScene.geometry_total,
      },
      `published_scene.${s.id}`,
      differences,
    );
  }
  aggregates[history] = { before, after, expected, differences };
}
const differenceCount =
  taskDiffs.reduce((n, r) => n + r.differences.length, 0) +
  Object.values(aggregates).reduce((n, r) => n + r.differences.length, 0);
fs.writeFileSync(path.join(LOCAL, 'network-audit.json'), JSON.stringify(audit, null, 2) + '\n');
// 0.125.1 attempts one "telemetry disabled" event even when telemetry is off.
// The offline guard blocks it before transport. Unexpected requests fail.
assert.ok(
  audit.stacks.every((s) => s.includes('Telemetry.recordTelemetryDisabled')),
  'Unexpected blocked network request; see .local/vision-astudio-v1/network-audit.json',
);
const verification = {
  status: differenceCount === 0 ? 'PASS' : 'FAIL',
  verified_at: new Date().toISOString(),
  promptfoo_version: JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version,
  dataset_sha256: dataset.cases_sha256,
  scoring_policy: SCORING_POLICY,
  scoring_policy_sha256: dataset.scoring_policy_sha256,
  comparison_mode: 'point_mean_recalculation_with_unchanged_atomic_decisions',
  task_count: 100,
  historical_answers: 200,
  original_summary: historyManifest.published_summary_path,
  original_summary_sha256: historyManifest.published_summary_sha256,
  byte_identical_core_files: verifiedFiles,
  verified_model_inputs: compact.length,
  raw_answers_unchanged: compact.length,
  new_model_calls: 0,
  new_judge_calls: 0,
  successful_network_requests: 0,
  blocked_telemetry_attempts: audit.attempts,
  semantic_method:
    'Historical atomic semantic decisions reused with exact answer and Gold hashes; geometry and aggregation recomputed independently in JavaScript.',
  semantic_review_status:
    'Assistant preliminary reviews; not re-judged or human-confirmed by this migration.',
  comparison_tolerance: 1e-9,
  difference_count: differenceCount,
  changed_score_count: taskDiffs.filter((t) => Math.abs(t.after - t.before) > 1e-9).length,
  aggregates,
  tasks: taskDiffs,
};
fs.writeFileSync(
  path.join(LOCAL, 'scored-results.jsonl'),
  compact.map((r) => JSON.stringify(r)).join('\n') + '\n',
);
fs.writeFileSync(
  path.join(LOCAL, 'verification.json'),
  JSON.stringify(verification, null, 2) + '\n',
);
assert.equal(
  differenceCount,
  0,
  `Scoring drift: ${differenceCount}; see .local/vision-astudio-v1/verification.json`,
);
const out = LOCAL;
fs.mkdirSync(out, { recursive: true });
const { renderReport } = await import('./report.mjs');
fs.writeFileSync(path.join(out, 'index.html'), renderReport(verification));
console.log(
  JSON.stringify(
    {
      status: verification.status,
      historical_answers: 200,
      differences: differenceCount,
      deepseek: aggregates.deepseek.after.score,
      sol: aggregates.sol.after.score,
      new_model_calls: 0,
      report: out,
    },
    null,
    2,
  ),
);
