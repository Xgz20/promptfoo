import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, test, vi } from 'vitest';
import {
  readDiagnosticCandidate,
  retryCandidate,
} from '../../scripts/astudio/vision/candidate-retry.mjs';
import { bytes, hash } from '../../scripts/astudio/vision/files.mjs';
import { candidatePath, modelKey, writeJSON } from '../../scripts/astudio/vision/live-provider.mjs';
import { datasetCases } from '../../scripts/astudio/vision/run-store.mjs';

let root;
const model = { id: 'test/model' };
const row = {
  vars: { question: 'file://prompts/canvas-001.txt', image: 'file://images/canvas-001.png' },
  metadata: {
    case_id: 'canvas-001',
    scene: 'canvas',
    prompt_sha256: hash(bytes('prompts/canvas-001.txt')),
    image_sha256: hash(bytes('images/canvas-001.png')),
    gold_sha256: hash(bytes('gold/canvas-001.json')),
  },
};
const previous = {
  ...row.metadata,
  model_id: model.id,
  status: 'error',
  request_id: 'old-request',
  output: '',
  answer_sha256: hash(''),
};
const next = {
  ...previous,
  status: 'ok',
  request_id: 'new-request',
  output: '{}',
  answer_sha256: hash('{}'),
};
const config = { parameters: { max_tokens: 32768 }, timeoutMs: 600000 };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-retry-'));
  writeJSON(candidatePath(root, model.id, row.metadata.case_id), previous);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

test('a retry archives the failed request, reuses frozen inputs and skips a completed replacement', async () => {
  const requester = vi.fn(async (actual, meta, input) => {
    assert.deepEqual(actual, config);
    assert.deepEqual(meta, row.metadata);
    assert.equal(hash(input[0].content[0].text), row.metadata.prompt_sha256);
    return { ...next };
  });
  const args = { runRoot: root, model, row, config, sourceRevision: 'test', requester };
  assert.equal((await retryCandidate(args)).status, 'ok');
  assert.equal((await retryCandidate(args)).status, 'skipped');
  assert.equal(requester.mock.calls.length, 1);
  const archive = path.join(
    root,
    'candidate-attempts',
    modelKey(model.id),
    'canvas-001',
    'old-request.json',
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(archive)), previous);
  const current = JSON.parse(fs.readFileSync(candidatePath(root, model.id, 'canvas-001')));
  assert.equal(current.retry.previous_request_id, previous.request_id);
  assert.equal(current.retry.timeout_ms, 600000);
});

test('a staged successful response survives a failed publication and avoids another API call', async () => {
  const originalRename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
    if (target === candidatePath(root, model.id, 'canvas-001')) {
      throw new Error('simulated publication failure');
    }
    return originalRename(source, target);
  });
  const requester = vi.fn(async () => ({ ...next }));
  const args = { runRoot: root, model, row, config, sourceRevision: 'test', requester };
  await assert.rejects(retryCandidate(args), /publication failure/);
  assert.equal(
    JSON.parse(fs.readFileSync(candidatePath(root, model.id, 'canvas-001'))).request_id,
    'old-request',
  );
  vi.restoreAllMocks();
  assert.equal((await retryCandidate(args)).status, 'ok');
  assert.equal(requester.mock.calls.length, 1);
});

test('run-local cases are verified by the frozen hash and remain independent of workspace edits', () => {
  const data = JSON.stringify(row) + '\n';
  fs.writeFileSync(path.join(root, 'dataset-cases.jsonl'), data);
  writeJSON(path.join(root, 'run.json'), { cases_sha256: hash(data) });
  assert.deepEqual(datasetCases(root), [row]);
  fs.appendFileSync(path.join(root, 'dataset-cases.jsonl'), ' ');
  assert.throws(() => datasetCases(root), /JSONL/);
});

function diagnosticFixture() {
  const directory = path.join(root, 'diagnostic');
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
  const record = {
    ...next,
    http_status: 200,
    usage,
    raw_response: {
      complete: true,
      json_valid: true,
      body: JSON.stringify({ usage, choices: [{ message: { content: next.output } }] }),
    },
  };
  const plan = {
    mode: 'diagnostic',
    baseline_run: root,
    model: model.id,
    stream: false,
    parameters: config.parameters,
    application_timeout_ms: config.timeoutMs,
    source_revision: 'diagnostic-test',
    cases: [
      {
        case_id: row.metadata.case_id,
        metadata: row.metadata,
        baseline_sha256: hash(fs.readFileSync(candidatePath(root, model.id, row.metadata.case_id))),
      },
    ],
  };
  writeJSON(path.join(directory, 'diagnostic.json'), plan);
  writeJSON(path.join(directory, `${row.metadata.case_id}.json`), record);
  return { directory, record, plan };
}

test('same-parameter diagnostic responses can be reused with their original provenance', async () => {
  const { directory } = diagnosticFixture();
  const imported = readDiagnosticCandidate({
    runRoot: root,
    directory,
    model,
    meta: row.metadata,
    config,
  });
  const result = await retryCandidate({
    runRoot: root,
    model,
    row,
    config,
    sourceRevision: 'test',
    requester: async () => imported,
  });
  assert.equal(result.status, 'ok');
  const current = JSON.parse(fs.readFileSync(candidatePath(root, model.id, row.metadata.case_id)));
  assert.equal(current.reused_diagnostic_response.source_revision, 'diagnostic-test');
  assert.equal(current.request_id, next.request_id);
});

test.each(['parameters', 'body', 'metadata'])('diagnostic reuse rejects mismatched %s', (field) => {
  const { directory, plan, record } = diagnosticFixture();
  if (field === 'parameters') {
    plan.parameters = { max_tokens: 131072 };
  }
  if (field === 'body') {
    record.raw_response.body = JSON.stringify({
      usage: record.usage,
      choices: [{ message: { content: 'different' } }],
    });
  }
  if (field === 'metadata') {
    record.image_sha256 = 'different';
  }
  writeJSON(path.join(directory, 'diagnostic.json'), plan);
  writeJSON(path.join(directory, `${row.metadata.case_id}.json`), record);
  assert.throws(() =>
    readDiagnosticCandidate({ runRoot: root, directory, model, meta: row.metadata, config }),
  );
});
