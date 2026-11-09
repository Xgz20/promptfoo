import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { REPO } from './files.mjs';

const { values } = parseArgs({
  options: {
    'run-dir': { type: 'string' },
    models: { type: 'string' },
    'cases-per-scene': { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'per-model-concurrency': { type: 'string', default: '1' },
    'judge-mode': { type: 'string', default: 'session' },
    'judge-concurrency': { type: 'string', default: '3' },
    output: { type: 'string' },
    resume: { type: 'boolean', default: false },
  },
});
assert.ok(['api', 'session'].includes(values['judge-mode']), 'judge-mode 应为 api 或 session');
const config = JSON.parse(fs.readFileSync(path.join(REPO, 'evals/vision/models.json'), 'utf8'));
if (values['judge-mode'] === 'api') {
  assert.ok(process.env[config.judge.api_key_env], `请设置 ${config.judge.api_key_env}`);
}
if (!values.resume) {
  assert.ok(process.env[config.api_key_env], `请设置 ${config.api_key_env}`);
}
if (values.resume) {
  assert.ok(values['run-dir'], 'resume 需同时指定 run-dir');
}
const runRoot = path.resolve(
  values['run-dir'] ??
    path.join(REPO, '.local/vision-runs', new Date().toISOString().replaceAll(/[:.]/g, '-')),
);

function execute(script, args, needsTypeScript = false) {
  const command = [
    ...(needsTypeScript ? ['--import', 'tsx'] : []),
    path.join(REPO, 'scripts/astudio/vision', script),
    ...args,
  ];
  const result = spawnSync(process.execPath, command, { cwd: REPO, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (!values.resume) {
  const args = [
    '--run-dir',
    runRoot,
    '--concurrency',
    values.concurrency,
    '--per-model-concurrency',
    values['per-model-concurrency'],
  ];
  for (const option of ['models', 'cases-per-scene']) {
    if (values[option]) {
      args.push(`--${option}`, values[option]);
    }
  }
  assert.equal(
    execute('evaluate-live.mjs', args, true),
    0,
    '候选采集阶段失败，已完成的记录保留在 run-dir',
  );
}
const judgeStatus = execute('judge-run.mjs', [
  '--run-dir',
  runRoot,
  '--mode',
  values['judge-mode'],
  '--concurrency',
  values['judge-concurrency'],
]);
const reportArgs = ['--run-dir', runRoot];
if (values.output) {
  reportArgs.push('--output', path.resolve(values.output));
}
const reportStatus = execute('report-xlsx.mjs', reportArgs);
process.exitCode = judgeStatus || reportStatus;
console.log(
  JSON.stringify(
    {
      run_dir: runRoot,
      judge_status: judgeStatus,
      report_status: reportStatus,
      next:
        values['judge-mode'] === 'session'
          ? '完成 session-judge 判分后使用 --resume 重新导入并生成报告'
          : '查看 Excel 的已评/计划题数与运行记录',
    },
    null,
    2,
  ),
);
