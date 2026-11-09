import assert from 'node:assert/strict';

import { test } from 'vitest';
import { aggregate } from '../../scripts/astudio/vision/aggregate.mjs';
import { bytes, hash, read } from '../../scripts/astudio/vision/files.mjs';
import messages from '../../scripts/astudio/vision/messages.mjs';
import grade, {
  DIMENSIONS,
  measureGeometry,
  parseAnswer,
  scoreAnswer,
} from '../../scripts/astudio/vision/score.mjs';

const cases = bytes('cases.jsonl').toString().trim().split('\n').map(JSON.parse);
// Synthetic in-memory decisions exercise the scoring contract. No model answers
// or historical run files are required by the committed test suite.
function sample(id = 'photo-001') {
  const meta = cases.find((t) => t.metadata.case_id === id).metadata;
  const gold = read(meta.gold_path),
    manifest = read(meta.manifest_path);
  const annotated = gold.annotations.length > 0;
  const checkpoints = [];
  for (const q of gold.content_questions) {
    if (q.dimension === '精确坐标定位') {
      continue;
    }
    for (const c of annotated ? q.checkpoints : q.checks) {
      checkpoints.push({
        id: c.id,
        question_id: q.id,
        dimension: q.dimension,
        expected: annotated ? c.expected : c.text,
        credit: 1,
      });
    }
  }
  for (const a of gold.annotations) {
    for (const r of a.rubric.slice(0, 2)) {
      r.checkpoint_ids.forEach((id, i) =>
        checkpoints.push({ id, dimension: r.dimension, expected: r.checkpoints[i], credit: 1 }),
      );
    }
  }
  let answer = gold.reference_answer;
  if (annotated) {
    answer = {
      content_answers: gold.content_questions.map((q) => ({
        question_id: q.id,
        answer: q.checkpoints.map((c) => c.expected).join('；'),
      })),
      edits: gold.annotations.map((a) => {
        const g = a.geometry;
        const point =
          g.type === 'bbox'
            ? [(g.bbox_xyxy[0] + g.bbox_xyxy[2]) / 2, (g.bbox_xyxy[1] + g.bbox_xyxy[3]) / 2]
            : g.polyline[0];
        return {
          annotation_id: a.id,
          target_description: 'test target',
          target_point: point.map((n, i) => (n * 1000) / gold.input_size[i]),
          requested_change: 'test intent',
          preserve: [],
        };
      }),
    };
  }
  const raw = JSON.stringify(answer);
  return {
    raw,
    meta,
    gold,
    manifest,
    schema: read(meta.schema_path),
    status: 'ok',
    review: {
      answer_sha256: hash(raw),
      gold_sha256: meta.gold_sha256,
      checkpoints,
      extra_edits: [],
      notes: [],
    },
  };
}
// Unit mutations below simulate a newly supplied review for a changed answer.
// Production grade() always requires the original exact hash-bound review.
function reviseAnswer(input, mutate) {
  const answer = JSON.parse(input.raw);
  mutate(answer);
  input.raw = JSON.stringify(answer);
  input.review.answer_sha256 = hash(input.raw);
}

test('edited output cannot reuse historical semantic decisions', () => {
  const s = sample();
  s.raw += '\n';
  assert.throws(() => scoreAnswer(s), /SEMANTIC_REVIEW_REQUIRED/);
});
test('changed Gold hash is rejected before scoring', () => {
  const s = sample();
  const context = {
    test: { metadata: { ...s.meta, gold_sha256: '0'.repeat(64) } },
    providerResponse: { metadata: { history_key: 'sol' } },
  };
  assert.throws(() => grade(s.raw, context), /HASH_MISMATCH/);
});
test('new model answer without a semantic review is an explicit error', () => {
  const s = sample();
  assert.throws(() => grade(s.raw, { test: { metadata: s.meta } }), /SEMANTIC_REVIEW_REQUIRED/);
});
test('bbox uses any inclusive target point, not distance to its center', () => {
  const g = {
    input_size: [1000, 500],
    annotations: [{ id: 'A', geometry: { type: 'bbox', bbox_xyxy: [100, 100, 900, 400] } }],
  };
  assert.equal(
    measureGeometry(g, { edits: [{ annotation_id: 'A', target_point: [100, 200] }] })[0]
      .geometric_hit,
    true,
  );
  assert.equal(
    measureGeometry(g, { edits: [{ annotation_id: 'A', target_point: [99.9, 200] }] })[0]
      .geometric_hit,
    false,
  );
});
test('center distance uses final input pixels and inclusive frozen tolerance', () => {
  const g = {
    input_size: [1000, 500],
    annotations: [],
    geometry: {
      G1: {
        kind: 'visible_bbox_center',
        center_input_px: [500, 250],
        bbox_input_px: [0, 0, 1000, 500],
        tolerance_input_px: 20,
      },
    },
  };
  const a = (y) => ({ content_answers: [{ id: 'G1', target_point: { x: 500, y } }] });
  assert.equal(measureGeometry(g, a(540))[0].geometric_hit, true);
  assert.equal(measureGeometry(g, a(540.01))[0].geometric_hit, false);
  assert.equal(measureGeometry(g, a(200))[0].geometric_hit, false); // In bbox, far from center.
});
test('polyline distance is segment distance, with an inclusive tolerance', () => {
  const g = {
    input_size: [1000, 1000],
    annotations: [
      {
        id: 'A',
        geometry: {
          type: 'polyline',
          polyline: [
            [100, 100],
            [200, 100],
            [200, 300],
          ],
          max_distance_px: 12,
        },
      },
    ],
  };
  const a = (p) => ({ edits: [{ annotation_id: 'A', target_point: p }] });
  assert.equal(measureGeometry(g, a([150, 112]))[0].geometric_hit, true);
  assert.equal(measureGeometry(g, a([150, 112.01]))[0].geometric_hit, false);
  assert.equal(measureGeometry(g, a([88, 100]))[0].geometric_hit, true); // Segment endpoint.
});
test('duplicate, missing and out-of-range points cannot earn geometry credit', () => {
  const s = sample();
  for (const mutate of [
    (a) => a.content_answers.push({ ...a.content_answers.find((q) => q.id === 'G1') }),
    (a) => {
      a.content_answers = a.content_answers.filter((q) => q.id !== 'G1');
    },
    (a) => {
      a.content_answers.find((q) => q.id === 'G1').target_point = { x: 1001, y: 300 };
    },
  ]) {
    const changed = structuredClone(s);
    reviseAnswer(changed, mutate);
    const r = scoreAnswer(changed);
    assert.equal(r.dimensions['精确坐标定位'].earned, 0);
    assert.equal(r.dimensions['对象属性与状态识别'].rate, 1);
  }
});
test('schema validity is diagnostic and cannot substitute for content scoring', () => {
  const s = sample();
  reviseAnswer(s, (a) => {
    a.unexpected_field = true;
  });
  const r = scoreAnswer(s);
  assert.equal(r.schema_valid, false);
  assert.equal(r.score, 100);
});
test('NA dimensions are excluded and cannot supply free score', () => {
  const id = cases.find(
    (t) =>
      !t.metadata.has_annotations &&
      !read(t.metadata.manifest_path)
        .tasks.find((x) => x.id === t.metadata.case_id)
        .applicable_dimensions.includes('文字识别'),
  ).metadata.case_id;
  const s = sample(id);
  reviseAnswer(s, (a) => {
    a.content_answers.find((q) => q.id === 'G1').target_point = null;
  });
  const r = scoreAnswer(s);
  assert.equal(r.applicable_weight_sum, 45);
  assert.equal(r.dimensions['文字识别'].rate, null);
  assert.equal(r.dimensions['批注目标识别'].rate, null);
  assert.ok(Math.abs(r.score - (100 * 35) / 45) < 1e-9);
  assert.equal(r.annotation_complete_rate_percent, null);
});
test('shared intent fails both related annotations, scoring its atom only once', () => {
  const s = sample('canvas-019'),
    before = scoreAnswer(s);
  const dependent = s.gold.annotations.find((a) => a.shared_constraints?.length);
  const shared = dependent.shared_constraints[0];
  const owner = s.gold.annotations.find((a) => a.id === shared.scored_in_annotation);
  const rubric = owner.rubric.find((r) => r.dimension === shared.dimension);
  const id = rubric.checkpoint_ids[rubric.checkpoints.indexOf(shared.checkpoint)];
  s.review.checkpoints.find((c) => c.id === id).credit = 0;
  const after = scoreAnswer(s),
    d = '批注意图理解';
  assert.equal(after.dimensions[d].possible, before.dimensions[d].possible);
  assert.equal(after.dimensions[d].earned, before.dimensions[d].earned - 1);
  assert.equal(after.annotation_outcomes.find((a) => a.annotation_id === owner.id).complete, false);
  assert.equal(
    after.annotation_outcomes.find((a) => a.annotation_id === dependent.id).complete,
    false,
  );
});
test('extra edits retain the existing ten-point penalty and whole-task rule', () => {
  const s = sample('canvas-001');
  s.review.extra_edits.push('unit-test extra change');
  const r = scoreAnswer(s);
  assert.equal(r.score, 90);
  assert.equal(r.fully_correct, false);
  assert.equal(r.annotation_complete_count, r.annotation_total);
});
test('technical failure zeros all applicable dimensions', () => {
  const s = sample('canvas-001');
  s.status = 'timeout';
  for (const c of s.review.checkpoints) {
    c.credit = 0;
  }
  const r = scoreAnswer(s);
  assert.equal(r.score, 0);
  assert.equal(r.annotation_complete_count, 0);
  assert.ok(Object.values(r.dimensions).every((d) => !d.applicable || d.rate === 0));
});
test('only exact outer code fences are removed; truncation is never repaired', () => {
  const raw = '{"x":1}';
  assert.deepEqual(parseAnswer('```json\n' + raw + '\n```').answer, { x: 1 });
  assert.equal(parseAnswer('Here is the answer: ' + raw).parse_method, 'unparseable');
  assert.equal(parseAnswer('{"x":').parse_method, 'unparseable');
});
test('actual message preserves prompt bytes and excludes metadata and Gold', () => {
  const vars = {
    case_id: 'photo-001',
    question: bytes('prompts/photo-001.txt').toString().trim(),
    image: 'data:image/png;base64,' + bytes('images/photo-001.png').toString('base64'),
  };
  const message = messages({ vars });
  assert.equal(message.length, 1);
  assert.equal(message[0].role, 'user');
  assert.equal(message[0].content.length, 2);
  assert.equal(message[0].content[0].text, bytes('prompts/photo-001.txt').toString());
  assert.equal(message[0].content[1].image_url.url, vars.image);
  assert.throws(() => messages({ vars: { ...vars, gold: 'must never be sent' } }));
});
test('aggregation keeps all called tasks and requires complete scene coverage', () => {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, { applicable: true, rate: 0, earned: 0, possible: 1 }]),
  );
  const r = {
    taskId: 'a',
    scene: 'one',
    score: 0,
    status: 'timeout',
    fully_correct: false,
    dimensions,
    annotation_outcomes: [],
    semantic_check_count: 5,
    semantic_correct_count: 0,
  };
  const summary = aggregate([r], [{ id: 'one', count: 1, name: 'Test' }]);
  assert.equal(summary.score, 0);
  assert.equal(summary.technical_failures, 1);
  assert.throws(() => aggregate([], [{ id: 'one', count: 1, name: 'Test' }]), /Incomplete scene/);
});
