import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { REPO, ROOT } from './files.mjs';
import { modelKey, readCandidate, writeJSON } from './live-provider.mjs';
import { datasetCases } from './run-store.mjs';

const { values } = parseArgs({
  options: { 'run-dir': { type: 'string' }, model: { type: 'string' } },
});
assert.ok(values['run-dir'] && values.model, '请指定 run-dir 和 model');
const runRoot = path.resolve(values['run-dir']);
const manifest = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));
const model = manifest.models.find((item) => item.id === values.model);
assert.ok(model, '模型不在本轮计划中');
const { config } = manifest;
const tests = datasetCases().filter(
  (row) =>
    manifest.case_ids.includes(row.metadata.case_id) &&
    !readCandidate(runRoot, model.id, row.metadata),
);
if (tests.length) {
  // Each model owns an SDK instance, database and connection pool in its process.
  Object.assign(process.env, {
    PROMPTFOO_CONFIG_DIR: path.join(runRoot, 'promptfoo', modelKey(model.id)),
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_REMOTE_GENERATION: '1',
    PROMPTFOO_FETCH_CONNECTIONS: String(manifest.per_model_concurrency),
    LOG_LEVEL: 'error',
  });
  const { default: promptfoo } = await import('../../../src/index.ts');
  const evaluation = await promptfoo.evaluate(
    {
      description: `AStudio 单图候选回答采集 ${model.name}`,
      basePath: ROOT,
      writeLatestResults: false,
      prompts: [`file://${path.join(REPO, 'scripts/astudio/vision/messages.mjs')}`],
      providers: [
        {
          id: `file://${path.join(REPO, 'scripts/astudio/vision/live-provider.mjs')}`,
          label: model.name,
          config: {
            model: model.id,
            baseUrl: config.base_url,
            apiKeyEnv: config.api_key_env,
            runRoot,
            timeoutMs: manifest.candidate_timeout_ms,
            maxRetries: 0,
            parameters: { ...manifest.candidate_parameters, ...model.parameters },
          },
        },
      ],
      tests,
    },
    { maxConcurrency: manifest.per_model_concurrency, cache: false, showProgressBar: false },
  );
  const summary = await evaluation.toEvaluateSummary();
  writeJSON(
    path.join(runRoot, 'promptfoo-candidate-results', modelKey(model.id), `${Date.now()}.json`),
    summary,
  );
}
