import assert from 'node:assert/strict';

import Ajv2020 from 'ajv/dist/2020.js';
import { fixtureFor, hash, verifiedJSON } from './files.mjs';
import { SCORING_POLICY } from './policy.mjs';

export const DIMENSIONS = [
  '文字识别',
  '对象属性与状态识别',
  '空间布局与连接关系识别',
  '批注目标识别',
  '批注意图理解',
  '精确坐标定位',
];
const validators = new Map();
const count = (values) => values.filter(Boolean).length;
const idsEqual = (wanted, got) =>
  wanted.length === got.length &&
  new Set(got).size === got.length &&
  wanted.every((id) => got.includes(id));
const isCoordinate = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000;

export function parseAnswer(raw) {
  try {
    return { answer: JSON.parse(raw), parse_method: 'strict_json' };
  } catch {}
  const fence = raw.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) {
    try {
      return { answer: JSON.parse(fence[1]), parse_method: 'removed_outer_code_fence_only' };
    } catch {}
  }
  return { answer: null, parse_method: 'unparseable' };
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length2 = dx * dx + dy * dy;
  const t = length2
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function measureGeometry(gold, answer, status = 'ok') {
  if (gold.annotations.length) {
    const edits = Array.isArray(answer?.edits) ? answer.edits : [];
    return gold.annotations.map((a) => {
      const matches = edits.filter((e) => e?.annotation_id === a.id);
      const normalized = matches.length === 1 ? (matches[0].target_point ?? null) : null;
      const valid =
        Array.isArray(normalized) && normalized.length === 2 && normalized.every(isCoordinate);
      const point = valid ? normalized.map((n, i) => (n * gold.input_size[i]) / 1000) : null;
      let hit = false,
        distance = null;
      const g = a.geometry;
      assert.ok(['bbox', 'polyline'].includes(g.type));
      if (point && g.type === 'bbox') {
        const [x1, y1, x2, y2] = g.bbox_xyxy;
        hit = point[0] >= x1 && point[0] <= x2 && point[1] >= y1 && point[1] <= y2;
      } else if (point) {
        distance = Math.min(
          ...g.polyline.slice(1).map((b, i) => segmentDistance(point, g.polyline[i], b)),
        );
        hit = distance <= g.max_distance_px;
      }
      // Original annotated analyzer records geometric hit independently of
      // request status; status is applied to dimension/annotation scores below.
      return {
        annotation_id: a.id,
        target_point: normalized,
        input_pixel_point: point,
        geometry_type: g.type,
        geometric_hit: hit,
        distance_to_polyline_px: distance,
      };
    });
  }
  const answers = Array.isArray(answer?.content_answers) ? answer.content_answers : [];
  return Object.entries(gold.geometry).map(([id, g]) => {
    assert.equal(g.kind, 'visible_bbox_center');
    const matches = answers.filter((a) => a?.id === id);
    const normalized = matches.length === 1 ? (matches[0].target_point ?? null) : null;
    const valid = Boolean(
      normalized &&
        !Array.isArray(normalized) &&
        typeof normalized === 'object' &&
        ['x', 'y'].every((k) => isCoordinate(normalized[k])),
    );
    const point = valid
      ? [(normalized.x * gold.input_size[0]) / 1000, (normalized.y * gold.input_size[1]) / 1000]
      : null;
    const distance = point
      ? Math.hypot(point[0] - g.center_input_px[0], point[1] - g.center_input_px[1])
      : null;
    return {
      question_id: id,
      target_point: normalized,
      input_pixel_point: point,
      gold_center_input_px: g.center_input_px,
      gold_bbox_input_px: g.bbox_input_px,
      distance_px: distance,
      tolerance_px: g.tolerance_input_px,
      valid_point: valid,
      geometric_hit: status === 'ok' && distance !== null && distance <= g.tolerance_input_px,
    };
  });
}

export function annotationOutcomes(annotations, checks, geometry, status) {
  const credits = new Map(checks.map((c) => [c.id, c.credit]));
  return annotations.map((a) => {
    const intent = [...a.rubric[1].checkpoint_ids];
    for (const shared of a.shared_constraints ?? []) {
      const owner = annotations.find((x) => x.id === shared.scored_in_annotation);
      const rubric = owner.rubric.find((r) => r.dimension === shared.dimension);
      const matches = rubric.checkpoint_ids.filter(
        (_id, i) => rubric.checkpoints[i] === shared.checkpoint,
      );
      assert.equal(matches.length, 1, 'Shared constraint must have exactly one owner');
      intent.push(matches[0]);
    }
    const intentIds = [...new Set(intent)];
    assert.ok(intentIds.length);
    const target = status === 'ok' && credits.get(`${a.id}.target`) === 1;
    const meaning = status === 'ok' && intentIds.every((id) => credits.get(id) === 1);
    const coordinate =
      status === 'ok' && geometry.find((x) => x.annotation_id === a.id).geometric_hit;
    const failures = [
      !target && DIMENSIONS[3],
      !meaning && DIMENSIONS[4],
      !coordinate && DIMENSIONS[5],
    ].filter(Boolean);
    return {
      annotation_id: a.id,
      target_correct: target,
      intent_correct: meaning,
      coordinate_correct: coordinate,
      complete: failures.length === 0,
      failed_components: failures,
      intent_checkpoint_ids: intentIds,
      failed_intent_checkpoint_ids: intentIds.filter((id) => credits.get(id) !== 1),
    };
  });
}

function validateReview(gold, review, status, annotated) {
  const expected = new Map();
  for (const q of gold.content_questions) {
    if (!annotated && q.dimension === DIMENSIONS[5]) {
      continue;
    }
    for (const c of annotated ? q.checkpoints : (q.checks ?? [])) {
      assert.ok(!expected.has(c.id), 'Duplicate Gold checkpoint');
      expected.set(c.id, {
        dimension: q.dimension,
        expected: annotated ? c.expected : c.text,
        question_id: q.id,
      });
    }
  }
  for (const a of gold.annotations) {
    for (const rubric of a.rubric.slice(0, 2)) {
      rubric.checkpoint_ids.forEach((id, i) => {
        assert.ok(!expected.has(id), 'Duplicate Gold checkpoint');
        expected.set(id, { dimension: rubric.dimension, expected: rubric.checkpoints[i] });
      });
    }
  }
  assert.ok(
    idsEqual(
      [...expected.keys()],
      review.checkpoints.map((c) => c.id),
    ),
    'Semantic checkpoint set mismatch',
  );
  for (const c of review.checkpoints) {
    assert.ok(c.credit === 0 || c.credit === 1);
    const e = expected.get(c.id);
    assert.equal(c.dimension, e.dimension);
    assert.equal(c.expected, e.expected);
    if (!annotated) {
      assert.equal(c.question_id, e.question_id);
    }
    if (status !== 'ok') {
      assert.equal(c.credit, 0, 'Failed requests cannot retain semantic credit');
    }
  }
}

// Review is a hash-bound list of atomic decisions, NOT the historical total.
// New outputs need new semantic decisions; geometry alone cannot grade meaning.
export function scoreAnswer({ raw, meta, gold, manifest, schema, review, status = 'ok' }) {
  assert.equal(hash(raw), review.answer_sha256, 'SEMANTIC_REVIEW_REQUIRED: answer hash changed');
  assert.equal(meta.gold_sha256, review.gold_sha256, 'SEMANTIC_REVIEW_REQUIRED: Gold hash changed');
  const annotated = gold.annotations.length > 0;
  assert.equal(meta.has_annotations, annotated);
  const task = manifest.tasks.find((t) => t.id === meta.case_id);
  assert.ok(task);
  assert.equal(manifest.version, meta.source_dataset_version);
  validateReview(gold, review, status, annotated);
  const parsed = parseAnswer(raw),
    answer = parsed.answer;
  if (!validators.has(meta.schema_sha256)) {
    validators.set(
      meta.schema_sha256,
      new Ajv2020({ strict: true, allErrors: true }).compile(schema),
    );
  }
  const schemaValid = validators.get(meta.schema_sha256)(answer);
  const geometry = measureGeometry(gold, answer, status);
  const dims = {};
  for (const d of DIMENSIONS) {
    const selected = review.checkpoints.filter((c) => c.dimension === d);
    const possible = d === DIMENSIONS[5] ? geometry.length : selected.length;
    const earned =
      status === 'ok'
        ? d === DIMENSIONS[5]
          ? count(geometry.map((g) => g.geometric_hit))
          : selected.reduce((n, c) => n + c.credit, 0)
        : 0;
    const applicable = annotated
      ? gold.dimension_rubric.find((r) => r.dimension === d).applicable
      : task.applicable_dimensions.includes(d);
    assert.equal(applicable, Boolean(possible));
    dims[d] = { applicable, earned, possible, rate: possible ? earned / possible : null };
  }
  const totalPoints = DIMENSIONS.reduce((n, d) => n + dims[d].possible, 0);
  const earnedPoints = DIMENSIONS.reduce((n, d) => n + dims[d].earned, 0);
  assert.ok(totalPoints > 0, 'A scored task needs at least one applicable point');
  const base = (100 * earnedPoints) / totalPoints;
  const penalty = annotated
    ? SCORING_POLICY.extra_edit_penalty_per_item * review.extra_edits.length
    : 0;
  const outcomes = annotationOutcomes(gold.annotations, review.checkpoints, geometry, status);
  const content = Array.isArray(answer?.content_answers) ? answer.content_answers : [];
  const wanted = gold.content_questions.map((q) => q.id);
  let idComplete, fieldRoles;
  if (annotated) {
    const edits = Array.isArray(answer?.edits) ? answer.edits : [];
    idComplete =
      idsEqual(
        wanted,
        content.map((q) => q?.question_id),
      ) &&
      idsEqual(
        gold.annotations.map((a) => a.id),
        edits.map((e) => e?.annotation_id),
      );
  } else {
    idComplete =
      answer?.task_id === meta.case_id &&
      idsEqual(
        wanted,
        content.map((q) => q?.id),
      );
    fieldRoles =
      idComplete &&
      content.every((q) => (q.id in gold.geometry ? q.answer === null : q.target_point === null));
  }
  return {
    taskId: meta.case_id,
    scene: meta.scene,
    status,
    answer_sha256: hash(raw),
    gold_sha256: review.gold_sha256,
    scoring_version: SCORING_POLICY.version,
    scoring_method: SCORING_POLICY.task_score,
    score: Math.max(SCORING_POLICY.score_floor, base - penalty),
    base_score: base,
    extra_edit_penalty: penalty,
    earned_points: earnedPoints,
    total_points: totalPoints,
    fully_correct:
      Object.values(dims)
        .filter((d) => d.applicable)
        .every((d) => d.rate === 1) && penalty === 0,
    dimensions: dims,
    geometry,
    annotation_outcomes: outcomes,
    annotation_complete_count: count(outcomes.map((a) => a.complete)),
    annotation_total: outcomes.length,
    annotation_complete_rate_percent: outcomes.length
      ? (100 * count(outcomes.map((a) => a.complete))) / outcomes.length
      : null,
    schema_valid: schemaValid,
    parse_method: parsed.parse_method,
    id_sets_complete: idComplete,
    ...(annotated ? {} : { field_roles_valid: fieldRoles }),
    semantic_check_count: review.checkpoints.length,
    semantic_correct_count: review.checkpoints.reduce((n, c) => n + c.credit, 0),
  };
}

export default function grade(output, context) {
  const meta = context.test.metadata;
  const history = context.providerResponse?.metadata?.history_key;
  assert.ok(
    history,
    'SEMANTIC_REVIEW_REQUIRED: no hash-bound review supplied; live judging is not enabled',
  );
  const gold = verifiedJSON(meta.gold_path, meta.gold_sha256);
  const manifest = verifiedJSON(meta.manifest_path, meta.manifest_sha256);
  const schema = verifiedJSON(meta.schema_path, meta.schema_sha256);
  const f = fixtureFor(history, meta.case_id);
  const result = scoreAnswer({
    raw: output,
    meta,
    gold,
    manifest,
    schema,
    review: f.semantic_review,
    status: f.status,
  });
  const namedScores = Object.fromEntries(
    DIMENSIONS.filter((d) => result.dimensions[d].applicable).map((d) => [
      d,
      result.dimensions[d].rate,
    ]),
  );
  namedScores['整题完整正确'] = Number(result.fully_correct);
  return {
    pass: result.fully_correct,
    score: result.score / 100,
    reason: `${result.taskId}: ${result.score.toFixed(4)}/100；得分点 ${result.earned_points}/${result.total_points}；${result.fully_correct ? '整题完整正确' : '存在失分项'}；沿用历史逐项语义判分`,
    namedScores,
    metadata: {
      vision_result: result,
      history_key: history,
      semantic_method: 'hash_bound_historical_decisions',
    },
  };
}
