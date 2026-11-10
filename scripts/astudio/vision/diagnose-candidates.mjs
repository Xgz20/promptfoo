import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { hash, REPO } from './files.mjs';
import { candidatePath, readCandidate, requestCandidate, writeJSON } from './live-provider.mjs';
import { caseMessages } from './messages.mjs';
import { datasetCases } from './run-store.mjs';

const { values } = parseArgs({
  options: {
    'run-dir': { type: 'string' },
    model: { type: 'string' },
    cases: { type: 'string' },
    'output-dir': { type: 'string' },
  },
});
assert.ok(
  values['run-dir'] && values.model && values.cases && values['output-dir'],
  '请指定 run-dir、model、cases 和 output-dir',
);
const runRoot = path.resolve(values['run-dir']);
const output = path.resolve(values['output-dir']);
assert.ok(
  !output.startsWith(runRoot + path.sep) && output !== runRoot,
  '诊断目录需与正式运行目录分开',
);
const manifest = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));
const model = manifest.models.find((item) => item.id === values.model);
assert.ok(model, '模型不在原计划中');
assert.ok(process.env[manifest.config.api_key_env], `请设置 ${manifest.config.api_key_env}`);
const ids = values.cases.split(',');
assert.equal(new Set(ids).size, ids.length, '用例重复');
const cases = datasetCases(runRoot);
const selected = ids.map((id) => {
  const row = cases.find((row) => row.metadata.case_id === id);
  assert.ok(row && manifest.case_ids.includes(id), `用例不在原计划中 ${id}`);
  const baseline = readCandidate(runRoot, model.id, row.metadata);
  assert.ok(baseline, '缺少基线调用记录');
  return { row, baseline_sha256: hash(fs.readFileSync(candidatePath(runRoot, model.id, id))) };
});
const parameters = { ...manifest.candidate_parameters, ...model.parameters };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(output);
writeJSON(path.join(output, 'diagnostic.json'), {
  mode: 'diagnostic',
  created_at: new Date().toISOString(),
  baseline_run: runRoot,
  model: model.id,
  parameters,
  stream: false,
  application_timeout_ms: manifest.candidate_timeout_ms,
  response_header_timeout_ms: Number(process.env.REQUEST_TIMEOUT_MS ?? 600000),
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim(),
  cases: selected.map(({ row, baseline_sha256 }) => ({
    case_id: row.metadata.case_id,
    baseline_sha256,
    metadata: row.metadata,
  })),
});
for (const { row, baseline_sha256 } of selected) {
  const record = await requestCandidate(
    {
      model: model.id,
      baseUrl: manifest.config.base_url,
      apiKeyEnv: manifest.config.api_key_env,
      parameters,
      timeoutMs: manifest.candidate_timeout_ms,
      captureResponse: true,
    },
    row.metadata,
    caseMessages(row.metadata.case_id),
  );
  writeJSON(path.join(output, `${row.metadata.case_id}.json`), record);
  assert.equal(
    hash(fs.readFileSync(candidatePath(runRoot, model.id, row.metadata.case_id))),
    baseline_sha256,
    '诊断期间基线记录发生变化',
  );
  console.log(
    JSON.stringify({
      case_id: record.case_id,
      status: record.status,
      finish_reason: record.finish_reason,
      output_chars: record.output.length,
      completion_tokens: record.usage?.completion_tokens,
    }),
  );
}
