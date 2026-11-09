import assert from 'node:assert/strict';

import { DIMENSIONS } from './score.mjs';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

export function aggregate(rows, scenes) {
  assert.equal(new Set(rows.map((r) => r.taskId)).size, rows.length);
  const sceneScores = scenes.map((s) => {
    const selected = rows.filter((r) => r.scene === s.id);
    assert.equal(selected.length, s.count, `Incomplete scene: ${s.id}`);
    const annotations = selected.flatMap((r) => r.annotation_outcomes ?? []);
    return {
      id: s.id,
      name: s.name,
      task_count: selected.length,
      score: mean(selected.map((r) => r.score)),
      earned_points: sum(
        selected.map((r) => sum(Object.values(r.dimensions).map((d) => d.earned))),
      ),
      total_points: sum(
        selected.map((r) => sum(Object.values(r.dimensions).map((d) => d.possible))),
      ),
      fully_correct: selected.filter((r) => r.fully_correct).length,
      annotation_complete: annotations.filter((a) => a.complete).length,
      annotation_total: annotations.length,
      geometry_hits: sum(selected.map((r) => r.dimensions[DIMENSIONS[5]].earned)),
      geometry_total: sum(selected.map((r) => r.dimensions[DIMENSIONS[5]].possible)),
    };
  });
  const complete = sum(sceneScores.map((s) => s.annotation_complete)),
    total = sum(sceneScores.map((s) => s.annotation_total));
  return {
    task_count: rows.length,
    score: mean(sceneScores.map((s) => s.score)),
    score_aggregation: 'equal_weight_six_scenes',
    task_mean_score: mean(rows.map((r) => r.score)),
    earned_points: sum(sceneScores.map((s) => s.earned_points)),
    total_points: sum(sceneScores.map((s) => s.total_points)),
    fully_correct: rows.filter((r) => r.fully_correct).length,
    annotation_complete: complete,
    annotation_total: total,
    annotation_complete_rate: total ? complete / total : null,
    technical_failures: rows.filter((r) => r.status !== 'ok').length,
    semantic_correct: sum(
      rows.map(
        (r) => r.semantic_correct_count ?? r.semantic_checks.reduce((n, c) => n + c.credit, 0),
      ),
    ),
    semantic_total: sum(rows.map((r) => r.semantic_check_count ?? r.semantic_checks.length)),
    dimensions: Object.fromEntries(
      DIMENSIONS.map((d) => {
        const selected = rows.map((r) => r.dimensions[d]).filter((x) => x.applicable);
        return [
          d,
          {
            applicable_task_count: selected.length,
            rate: mean(selected.map((x) => x.rate)),
            earned: sum(selected.map((x) => x.earned)),
            possible: sum(selected.map((x) => x.possible)),
          },
        ];
      }),
    ),
    scenes: sceneScores,
  };
}

// Reports created in Python and JavaScript may differ in the last binary digit.
// Check unrounded values, with 1e-9 absolute tolerance; never round to hide drift.
export function compare(actual, expected, label = 'result', diffs = []) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (
      !Number.isFinite(actual) ||
      !Number.isFinite(expected) ||
      Math.abs(actual - expected) > 1e-9
    ) {
      diffs.push({ path: label, before: expected, after: actual });
    }
  } else if (expected && typeof expected === 'object') {
    if (
      !actual ||
      typeof actual !== 'object' ||
      Array.isArray(actual) !== Array.isArray(expected)
    ) {
      diffs.push({ path: label, before: expected, after: actual ?? null });
    } else {
      if (Array.isArray(expected) && actual.length !== expected.length) {
        diffs.push({ path: label + '.length', before: expected.length, after: actual.length });
      }
      for (const key of Object.keys(expected)) {
        compare(actual[key], expected[key], `${label}.${key}`, diffs);
      }
    }
  } else if (actual !== expected) {
    diffs.push({ path: label, before: expected, after: actual ?? null });
  }
  return diffs;
}
