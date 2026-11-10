import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, test, vi } from 'vitest';
import { retryCandidate } from '../../scripts/astudio/vision/candidate-retry.mjs';
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
