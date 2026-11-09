import assert from 'node:assert/strict';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { writeJSON } from './live-provider.mjs';
import { reportForRun } from './run-store.mjs';
import { exportReport } from './xlsx.mjs';

const { values } = parseArgs({
  options: {
    'run-dir': { type: 'string' },
    output: { type: 'string' },
    'preview-dir': { type: 'string' },
  },
});
assert.ok(values['run-dir'], '请指定 --run-dir');
const runRoot = path.resolve(values['run-dir']);
const report = reportForRun(runRoot);
const output = path.resolve(
  values.output ?? path.join(runRoot, 'outputs', report.run_id, '视觉模型评测报告.xlsx'),
);
writeJSON(path.join(runRoot, 'report-data.json'), report);
const result = await exportReport(report, output, values['preview-dir']);
console.log(JSON.stringify(result, null, 2));
