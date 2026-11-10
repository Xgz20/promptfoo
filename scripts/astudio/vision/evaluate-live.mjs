import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { forEachConcurrent } from './concurrency.mjs';
import { bytes, hash, REPO, read } from './files.mjs';
import { exportSessionJudge } from './judge.mjs';
import { modelKey, writeJSON } from './live-provider.mjs';
import { fetchForVision } from './network.mjs';
import { refreshPricing } from './pricing.mjs';
import { datasetCases, loadRun } from './run-store.mjs';
import { verifyDataset } from './verify-dataset.mjs';

const { values } = parseArgs({
  options: {
    config: { type: 'string', default: path.join(REPO, 'evals/vision/models.json') },
    models: { type: 'string' },
    'cases-per-scene': { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'per-model-concurrency': { type: 'string', default: '1' },
    'max-tokens': { type: 'string', default: '8192' },
    'timeout-ms': { type: 'string', default: '600000' },
    'run-dir': { type: 'string' },
    resume: { type: 'boolean', default: false },
  },
});
const config = JSON.parse(fs.readFileSync(values.config, 'utf8'));
const requested = values.models?.split(',');
const models = requested
  ? requested.map((id) => {
      const model = config.models.find((model) => model.id === id);
      assert.ok(model, `模型不在选型列表中 ${id}`);
      return model;
    })
  : config.models;
assert.ok(
  models.length && new Set(models.map((model) => model.id)).size === models.length,
  '模型列表为空或重复',
);
assert.ok(process.env[config.api_key_env], `请设置 ${config.api_key_env}`);
const accessResponse = await fetchForVision(`${config.base_url.replace(/\/$/, '')}/models`, {
  headers: { Authorization: `Bearer ${process.env[config.api_key_env]}` },
  signal: AbortSignal.timeout(30000),
});
assert.ok(accessResponse.ok, `候选模型目录鉴权失败 HTTP ${accessResponse.status}`);
const access = await accessResponse.json();
for (const model of models) {
  assert.ok(
    access.data?.some((available) => available.id === model.id),
    `当前密钥无法访问模型 ${model.id}`,
  );
}
const concurrency = Number(values.concurrency);
assert.ok(Number.isInteger(concurrency) && concurrency > 0, '并发数需为正整数');
const perModelConcurrency = Number(values['per-model-concurrency']);
assert.ok(
  Number.isInteger(perModelConcurrency) && perModelConcurrency > 0,
  '模型内部并发数需为正整数',
);
const timeoutMs = Number(values['timeout-ms']);
assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0, 'timeout-ms 需为正整数');
const maxTokens = Number(values['max-tokens']);
assert.ok(Number.isInteger(maxTokens) && maxTokens > 0, 'max-tokens 需为正整数');
const limit = values['cases-per-scene'] ? Number(values['cases-per-scene']) : null;
assert.ok(limit === null || (Number.isInteger(limit) && limit > 0), 'cases-per-scene 需为正整数');
verifyDataset();
const dataset = read('manifest.json');
const allCases = datasetCases();
const selected = dataset.scenes.flatMap((scene) => {
  const rows = allCases.filter((row) => row.metadata.scene === scene.id);
  return limit === null ? rows : rows.slice(0, limit);
});
const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
const runRoot = path.resolve(values['run-dir'] ?? path.join(REPO, '.local/vision-runs', runId));
fs.mkdirSync(path.dirname(runRoot), { recursive: true });
assert.ok(!values.resume || values['run-dir'], 'resume 需指定 run-dir');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO,
  encoding: 'utf8',
}).trim();
let manifest = {
  run_id: runId,
  created_at: new Date().toISOString(),
  source_revision: sourceRevision,
  config,
  models,
  source_dirty:
    execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim().length >
    0,
  dataset_version: 'astudio-v1',
  dataset_size: allCases.length,
  cases_sha256: dataset.cases_sha256,
  scope: selected.length === allCases.length ? 'full' : 'smoke',
  case_ids: selected.map((row) => row.metadata.case_id),
  scenes: dataset.scenes.map((scene) => ({
    id: scene.id,
    name: scene.name,
    count: selected.filter((row) => row.metadata.scene === scene.id).length,
  })),
  concurrency,
  concurrency_mode: 'model-workers',
  per_model_concurrency: perModelConcurrency,
  candidate_timeout_ms: timeoutMs,
  max_tokens: maxTokens,
  candidate_parameters: { max_tokens: maxTokens },
};
if (values.resume) {
  const existing = loadRun(runRoot).manifest;
  for (const key of [
    'source_revision',
    'source_dirty',
    'config',
    'models',
    'cases_sha256',
    'case_ids',
    'concurrency',
    'concurrency_mode',
    'per_model_concurrency',
    'candidate_timeout_ms',
    'candidate_parameters',
  ]) {
    assert.deepEqual(existing[key], manifest[key], `断点恢复参数与原计划不一致 ${key}`);
  }
  manifest = existing;
} else {
  fs.mkdirSync(runRoot); // Existing runs require an explicit, hash-checked resume.
  fs.writeFileSync(path.join(runRoot, 'dataset-cases.jsonl'), bytes('cases.jsonl'));
  const pricing = await refreshPricing(config.models);
  writeJSON(path.join(runRoot, 'pricing.json'), pricing);
  manifest.pricing_sha256 = hash(JSON.stringify(pricing));
  writeJSON(path.join(runRoot, 'run.json'), manifest);
}
const lock = path.join(runRoot, '.candidate.lock');
const descriptor = fs.openSync(lock, 'wx');
fs.writeFileSync(
  descriptor,
  JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
);
fs.closeSync(descriptor);
const children = new Set();
let stopping = false;
const stop = () => {
  stopping = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  await forEachConcurrent(
    models,
    concurrency,
    (model) =>
      new Promise((resolve, reject) => {
        assert.ok(!stopping, '候选采集已停止');
        const child = spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            path.join(REPO, 'scripts/astudio/vision/candidate-worker.mjs'),
            '--run-dir',
            runRoot,
            '--model',
            model.id,
          ],
          { cwd: REPO, stdio: 'inherit' },
        );
        children.add(child);
        child.once('error', reject);
        child.once('close', (code, signal) => {
          children.delete(child);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`模型采集进程失败 ${model.id} code=${code} signal=${signal}`));
          }
        });
      }),
  );
} finally {
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  fs.unlinkSync(lock);
}
writeJSON(path.join(runRoot, 'promptfoo-candidate-results.json'), {
  format: 'vision-candidate-workers-v1',
  models: models.map((model) => {
    const directory = path.join(runRoot, 'promptfoo-candidate-results', modelKey(model.id));
    return {
      model_id: model.id,
      summaries: fs
        .readdirSync(directory)
        .sort()
        .map((file) => path.relative(runRoot, path.join(directory, file))),
    };
  }),
});
const run = loadRun(runRoot);
assert.equal(run.jobs.length, models.length * selected.length, '候选调用记录不完整');
exportSessionJudge(runRoot, run.jobs);
console.log(
  JSON.stringify(
    {
      run_dir: runRoot,
      models: models.length,
      cases_per_model: selected.length,
      candidate_calls: run.jobs.length,
      concurrency,
      per_model_concurrency: perModelConcurrency,
      scope: manifest.scope,
      next: '执行 judge-run.mjs，或在 Codex 会话完成 session-judge 判分后导入',
    },
    null,
    2,
  ),
);
if (run.jobs.some(({ candidate }) => candidate.status === 'invalid_configuration')) {
  process.exitCode = 1;
}
