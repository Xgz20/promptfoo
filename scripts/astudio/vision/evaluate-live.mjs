import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { hash, REPO, ROOT, read } from './files.mjs';
import { exportSessionJudge } from './judge.mjs';
import { writeJSON } from './live-provider.mjs';
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
    'max-tokens': { type: 'string', default: '8192' },
    'run-dir': { type: 'string' },
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
fs.mkdirSync(runRoot); // An existing run cannot accidentally issue paid requests again.
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO,
  encoding: 'utf8',
}).trim();
const manifest = {
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
  max_tokens: maxTokens,
  candidate_parameters: { max_tokens: maxTokens },
};
const pricing = await refreshPricing(config.models);
writeJSON(path.join(runRoot, 'pricing.json'), pricing);
manifest.pricing_sha256 = hash(JSON.stringify(pricing));
writeJSON(path.join(runRoot, 'run.json'), manifest);

Object.assign(process.env, {
  PROMPTFOO_CONFIG_DIR: path.join(runRoot, 'promptfoo'),
  PROMPTFOO_DISABLE_TELEMETRY: '1',
  PROMPTFOO_DISABLE_REMOTE_GENERATION: '1',
  LOG_LEVEL: 'error',
});
const { default: promptfoo } = await import('../../../src/index.ts');
const evaluation = await promptfoo.evaluate(
  {
    description: 'AStudio 单图候选回答采集，视觉评分由逐点裁判阶段生成',
    basePath: ROOT,
    writeLatestResults: false,
    prompts: [`file://${path.join(REPO, 'scripts/astudio/vision/messages.mjs')}`],
    providers: models.map((model) => ({
      id: `file://${path.join(REPO, 'scripts/astudio/vision/live-provider.mjs')}`,
      label: model.name,
      config: {
        model: model.id,
        baseUrl: config.base_url,
        apiKeyEnv: config.api_key_env,
        runRoot,
        parameters: { ...manifest.candidate_parameters, ...model.parameters },
      },
    })),
    tests: selected,
  },
  { maxConcurrency: concurrency, cache: false, showProgressBar: false },
);
const summary = await evaluation.toEvaluateSummary();
writeJSON(path.join(runRoot, 'promptfoo-candidate-results.json'), summary);
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
