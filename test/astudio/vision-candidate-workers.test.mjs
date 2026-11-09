import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test } from 'vitest';
import { hash } from '../../scripts/astudio/vision/files.mjs';
import {
  candidatePath,
  readCandidate,
  writeJSON,
} from '../../scripts/astudio/vision/live-provider.mjs';
import { datasetCases } from '../../scripts/astudio/vision/run-store.mjs';

test('saved candidate records must match the image, prompt, Gold and answer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-candidate-'));
  const row = datasetCases()[0];
  const file = candidatePath(root, 'test/model', row.metadata.case_id);
  try {
    assert.equal(readCandidate(root, 'test/model', row.metadata), null);
    const candidate = {
      ...row.metadata,
      model_id: 'test/model',
      output: 'answer',
      answer_sha256: hash('answer'),
    };
    writeJSON(file, candidate);
    assert.deepEqual(readCandidate(root, 'test/model', row.metadata), candidate);
    for (const key of ['image_sha256', 'prompt_sha256', 'gold_sha256', 'answer_sha256']) {
      writeJSON(file, { ...candidate, [key]: 'changed' });
      assert.throws(() => readCandidate(root, 'test/model', row.metadata));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
