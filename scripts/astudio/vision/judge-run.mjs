import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { forEachConcurrent } from './concurrency.mjs';
import { exportSessionJudge, importSessionDecision, judgeCandidate, reviewPath } from './judge.mjs';
import { writeJSON } from './live-provider.mjs';
import { buildReport } from './metrics.mjs';
import { loadRun } from './run-store.mjs';

const { values } = parseArgs({
  options: {
    'run-dir': { type: 'string' },
    mode: { type: 'string', default: 'session' },
    concurrency: { type: 'string', default: '3' },
  },
});
assert.ok(values['run-dir'], '请指定 --run-dir');
assert.ok(['api', 'session', 'export'].includes(values.mode), 'mode 应为 api、session 或 export');
const runRoot = path.resolve(values['run-dir']);
const initial = loadRun(runRoot);
if (values.mode === 'export') {
  console.log(exportSessionJudge(runRoot, initial.jobs));
} else {
  if (values.mode === 'api') {
    assert.ok(
      process.env[initial.config.judge.api_key_env],
      `请设置 ${initial.config.judge.api_key_env}`,
    );
  }
  const lock = path.join(runRoot, '.judge.lock');
  const descriptor = fs.openSync(lock, 'wx');
  fs.closeSync(descriptor);
  let completed = 0,
    failures = 0;
  try {
    await forEachConcurrent(
      initial.jobs,
      Number(values.concurrency),
      async ({ row, candidate }) => {
        if (candidate.status !== 'ok') {
          return;
        }
        const file = reviewPath(runRoot, candidate.model_id, candidate.case_id);
        if (fs.existsSync(file)) {
          return;
        }
        try {
          const reviewed =
            values.mode === 'api'
              ? await judgeCandidate(row, candidate, initial.config.judge)
              : importSessionDecision(runRoot, row, candidate);
          if (reviewed) {
            writeJSON(file, reviewed);
            completed++;
          }
        } catch (error) {
          failures++;
          writeJSON(file.replace(/\.json$/, '.error.json'), {
            case_id: candidate.case_id,
            model_id: candidate.model_id,
            error: error.message,
          });
        }
      },
    );
    const current = loadRun(runRoot);
    const report = buildReport(current);
    writeJSON(path.join(runRoot, 'report-data.json'), report);
    fs.writeFileSync(
      path.join(runRoot, 'scored-results.jsonl'),
      current.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    );
    console.log(
      JSON.stringify(
        {
          completed_this_pass: completed,
          judge_errors: failures,
          models: report.overall.map(
            ({ name, planned, graded, pending_judgments, failed_calls }) => ({
              name,
              planned,
              graded,
              pending_judgments,
              failed_calls,
            }),
          ),
          report_data: path.join(runRoot, 'report-data.json'),
        },
        null,
        2,
      ),
    );
    if (failures) {
      process.exitCode = 1;
    }
  } finally {
    fs.unlinkSync(lock);
  }
}
