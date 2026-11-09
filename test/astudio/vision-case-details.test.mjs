import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';
import {
  checkpointDefinitions,
  checkpointResults,
  pivotCaseDetails,
} from '../../scripts/astudio/vision/case-details.mjs';
import { ROOT } from '../../scripts/astudio/vision/files.mjs';
import {
  caseColumnPlan,
  compactLines,
  excelColumn,
  hideColumnDefinitions,
} from '../../scripts/astudio/vision/workbook-layout.mjs';

const canvas = JSON.parse(fs.readFileSync(path.join(ROOT, 'gold/canvas-001.json'), 'utf8'));

test('case detail lists all 1041 frozen points including each geometry target once', () => {
  let count = 0,
    geometry = 0;
  for (const file of fs.readdirSync(path.join(ROOT, 'gold'))) {
    const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'gold', file), 'utf8'));
    const points = checkpointDefinitions(gold);
    count += points.length;
    geometry += points.filter((point) => point.kind === 'geometry').length;
    assert.equal(new Set(points.map((point) => point.id)).size, points.length);
  }
  assert.equal(count, 1041);
  assert.equal(geometry, 145);
});

test('ten correct semantic points and a missed coordinate produce ten of eleven credits', () => {
  const definitions = checkpointDefinitions(canvas);
  const review = {
    checkpoints: definitions
      .filter((point) => point.kind === 'semantic')
      .map((point) => ({ ...point, credit: 1, reason: '满足语义要求' })),
  };
  const result = {
    status: 'ok',
    earned_points: 10,
    total_points: 11,
    geometry: [{ annotation_id: 'A', geometric_hit: false }],
  };
  const points = checkpointResults(definitions, result, review);
  assert.equal(points.find((point) => point.id === 'A.point').credit, 0);
  assert.equal(
    points.reduce((sum, point) => sum + point.credit, 0),
    10,
  );
  assert.ok(points.every((point) => point.credit === 0 || point.credit === 1));
});

test('pending points remain unknown and failed requests cannot receive geometric credit', () => {
  const definitions = checkpointDefinitions(canvas);
  assert.ok(checkpointResults(definitions, null, null).every((point) => point.credit === null));
  const review = {
    checkpoints: definitions
      .filter((point) => point.kind === 'semantic')
      .map((point) => ({ ...point, credit: 0 })),
  };
  const failed = {
    status: 'error',
    earned_points: 0,
    total_points: 11,
    geometry: [{ annotation_id: 'A', geometric_hit: true }],
  };
  assert.ok(checkpointResults(definitions, failed, review).every((point) => point.credit === 0));
});

test('multiple model records pivot to exactly one case row without losing point results', () => {
  const definitions = checkpointDefinitions(canvas);
  const records = ['model/a', 'model/b'].map((id, index) => ({
    model_id: id,
    case_id: 'canvas-001',
    case_name: '画布',
    scene: 'canvas',
    checkpoints: definitions.map((point) => ({ ...point, credit: index, reason: 'test' })),
    result: {
      score: index * 100,
      base_score: index * 100,
      extra_edit_penalty: 0,
      earned_points: index * definitions.length,
    },
  }));
  const models = [
    { id: 'model/a', name: 'A' },
    { id: 'model/b', name: 'B' },
  ];
  const rows = pivotCaseDetails(records, models);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].checkpoints.length, 11);
  assert.deepEqual(
    rows[0].models.map((model) => model.score),
    [0, 100],
  );
  assert.equal(rows[0].models[0].checkpoints[0].credit, 0);
  assert.equal(rows[0].models[1].checkpoints[0].credit, 1);
  assert.throws(() => pivotCaseDetails([records[0], records[0]], models), /重复/);
});

test('the case column layout scales past Z while preserving one score/detail pair per model', () => {
  assert.equal(excelColumn(0), 'A');
  assert.equal(excelColumn(25), 'Z');
  assert.equal(excelColumn(26), 'AA');
  assert.equal(excelColumn(701), 'ZZ');
  assert.equal(excelColumn(702), 'AAA');
  const models = Array.from({ length: 8 }, (_item, index) => ({
    id: `model/${index}`,
    name: `模型${index}`,
  }));
  const plan = caseColumnPlan(models);
  assert.equal(plan.visibleHeaders.length, 4 + models.length * 2);
  assert.equal(plan.modelColumns.length, 8);
  assert.ok(plan.lastColumn > 255);
  assert.ok(
    plan.modelColumns.every(
      (columns) => columns.score < plan.auxiliaryFirst && columns.points < plan.auxiliaryFirst,
    ),
  );
});

test('long checkpoint lists are compacted without dropping definitions', () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'gold'))) {
    const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'gold', file), 'utf8'));
    const items = checkpointDefinitions(gold).map((point) => `${point.id} ${point.expected}`);
    const compact = compactLines(items, 100);
    assert.equal(compact.text.replace(/\s/g, ''), items.join('').replace(/\s/g, ''));
    assert.ok(compact.lineCount * 13 + 10 <= 409.5, `用例检查点超过单行显示容量 ${file}`);
  }
});

test('native helper-column hiding splits spans and preserves visible column styles', () => {
  const xml =
    '<worksheet><cols><col min="1" max="12" width="20" style="2"/><col min="13" max="20" width="18"/></cols></worksheet>';
  const hidden = hideColumnDefinitions(xml, 10, 20);
  assert.ok(hidden.includes('<col min="1" max="9" width="20" style="2"/>'));
  assert.ok(hidden.includes('<col min="10" max="12" width="20" style="2" hidden="1"/>'));
  assert.ok(hidden.includes('<col min="13" max="20" width="18" hidden="1"/>'));
  const namespaced =
    '<x:cols><x:col min="2" max="9" width="20" hidden="0" /><x:col min="10" max="70" width="18" hidden="0" customWidth="1" /></x:cols>';
  const result = hideColumnDefinitions(namespaced, 10, 70);
  assert.ok(result.includes('<x:col min="2" max="9" width="20" hidden="0" />'));
  assert.ok(result.includes('min="10" max="70" width="18" customWidth="1"  hidden="1"/>'));
  const alreadyHidden = hideColumnDefinitions(
    '<cols><col min="1" max="12" hidden="1" width="20"/></cols>',
    10,
    12,
  );
  assert.ok(alreadyHidden.includes('min="1" max="9" hidden="1" width="20"'));
});
