import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test } from 'vitest';
import {
  publishReport,
  reportTimestamp,
  timestampedReportPath,
} from '../../scripts/astudio/vision/report-path.mjs';

test('report timestamps use Shanghai time and second precision including midnight rollover', () => {
  assert.equal(reportTimestamp('2026-11-09T16:01:02.003Z'), '20261110_000102');
  assert.equal(reportTimestamp('2026-11-09T10:24:18.615Z'), '20261109_182418');
  assert.equal(reportTimestamp('2026-11-09T10:24:18.999Z'), '20261109_182418');
  assert.throws(() => reportTimestamp('invalid-date'), /生成时间无效/);
});

test('default and custom report names carry the generation timestamp', () => {
  const generatedAt = '2026-11-09T10:24:18.615Z';
  const runRoot = path.resolve('run-root');
  assert.equal(
    timestampedReportPath({ runRoot, runId: 'run-a', generatedAt }),
    path.join(runRoot, 'outputs/run-a/视觉模型评测报告_20261109_182418.xlsx'),
  );
  const requestedPath = path.resolve('report folder/业务对比-v2.XLSX');
  assert.equal(
    timestampedReportPath({ runRoot, runId: 'run-a', requestedPath, generatedAt }),
    path.resolve('report folder/业务对比-v2_20261109_182418.xlsx'),
  );
});

test('same-second exports share the base timestamp while later seconds get a new name', () => {
  const options = { runRoot: path.resolve('run-root'), runId: 'same-run' };
  const first = timestampedReportPath({ ...options, generatedAt: '2026-11-09T10:24:18.615Z' });
  const sameSecond = timestampedReportPath({ ...options, generatedAt: '2026-11-09T10:24:18.999Z' });
  const nextSecond = timestampedReportPath({ ...options, generatedAt: '2026-11-09T10:24:19.000Z' });
  assert.equal(first, sameSecond);
  assert.notEqual(first, nextSecond);
});

test('publishing a colliding report preserves existing files and appends a sequence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-report-path-'));
  try {
    const source = path.join(root, 'source');
    const requested = path.join(root, '报告_20261109_182418.xlsx');
    fs.writeFileSync(source, 'new-report');
    fs.writeFileSync(requested, 'existing-report');
    const second = publishReport(source, requested);
    const third = publishReport(source, requested);
    assert.equal(second, path.join(root, '报告_20261109_182418_2.xlsx'));
    assert.equal(third, path.join(root, '报告_20261109_182418_3.xlsx'));
    assert.equal(fs.readFileSync(requested, 'utf8'), 'existing-report');
    assert.equal(fs.readFileSync(second, 'utf8'), 'new-report');
    assert.equal(fs.readFileSync(third, 'utf8'), 'new-report');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
