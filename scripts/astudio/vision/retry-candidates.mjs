import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { retryCandidate } from './candidate-retry.mjs';
import { REPO } from './files.mjs';
import { loadRun } from './run-store.mjs';

const { values } = parseArgs({
  options: {
    'run-dir': { type: 'string' },
    model: { type: 'string' },
    cases: { type: 'string' },
    'timeout-ms': { type: 'string', default: '600000' },
  },
});
assert.ok(values['run-dir'] && values.model && values.cases, '请指定 run-dir、model 和 cases');
const runRoot = path.resolve(values['run-dir']);
const timeoutMs = Number(values['timeout-ms']);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeout-ms需为正整数');
const locks = [];
try {
  for (const name of ['.candidate.lock', '.judge.lock']) {
    const lock = path.join(runRoot, name);
    const descriptor = fs.openSync(lock, 'wx');
    fs.closeSync(descriptor);
    locks.push(lock);
  }
  const run = loadRun(runRoot);
  const model = run.manifest.models.find((item) => item.id === values.model);
  assert.ok(model, '模型不在原评测计划中');
  assert.ok(process.env[run.config.api_key_env], `请设置 ${run.config.api_key_env}`);
  const ids = values.cases.split(',');
  assert.equal(new Set(ids).size, ids.length, '题号重复');
  const jobs = ids.map((id) => {
    const job = run.jobs.find(
      (job) => job.candidate.model_id === model.id && job.row.metadata.case_id === id,
    );
    assert.ok(job, `缺少原题记录 ${id}`);
    return job;
  });
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim();
  const config = {
    model: model.id,
    baseUrl: run.config.base_url,
    apiKeyEnv: run.config.api_key_env,
    timeoutMs,
    parameters: { ...run.manifest.candidate_parameters, ...model.parameters },
  };
  for (const { row } of jobs) {
    const result = await retryCandidate({ runRoot, model, row, config, sourceRevision });
    console.log(JSON.stringify(result));
    if (!['ok', 'skipped'].includes(result.status)) {
      process.exitCode = 1;
    }
  }
} finally {
  for (const lock of locks.reverse()) {
    fs.unlinkSync(lock);
  }
}
