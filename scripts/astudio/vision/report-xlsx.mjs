import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { REPO } from './files.mjs';
import { writeJSON } from './live-provider.mjs';
import { publishReport, timestampedReportPath } from './report-path.mjs';
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
report.report_source_revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO,
  encoding: 'utf8',
}).trim();
const requested = timestampedReportPath({
  runRoot,
  runId: report.run_id,
  requestedPath: values.output,
  generatedAt: report.generated_at,
});
fs.mkdirSync(path.dirname(requested), { recursive: true });
const temporary = fs.mkdtempSync(path.join(path.dirname(requested), '.report-export-'));
try {
  writeJSON(path.join(runRoot, 'report-data.json'), report);
  const source = path.join(temporary, 'report.xlsx');
  const result = await exportReport(report, source, values['preview-dir']);
  const output = publishReport(source, requested);
  console.log(JSON.stringify({ ...result, output }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
