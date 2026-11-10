import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { hash } from './files.mjs';
import {
  candidatePath,
  modelKey,
  readCandidate,
  requestCandidate,
  writeJSON,
} from './live-provider.mjs';
import { caseMessages } from './messages.mjs';

// The caller owns both candidate and judge locks during this transaction.
export async function retryCandidate({
  runRoot,
  model,
  row,
  config,
  sourceRevision,
  requester = requestCandidate,
}) {
  const previous = readCandidate(runRoot, model.id, row.metadata);
  assert.ok(previous, '补跑需存在原调用记录');
  if (previous.status === 'ok') {
    return { status: 'skipped', case_id: previous.case_id };
  }
  assert.equal(previous.status, 'error', '配置异常需先修复配置');
  const directory = path.join(runRoot, 'candidate-attempts', modelKey(model.id), previous.case_id);
  const original = path.join(directory, `${previous.request_id}.json`);
  if (fs.existsSync(original)) {
    assert.equal(
      hash(fs.readFileSync(original)),
      hash(fs.readFileSync(candidatePath(runRoot, model.id, previous.case_id))),
      '原调用归档不一致',
    );
  } else {
    fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(
      candidatePath(runRoot, model.id, previous.case_id),
      original,
      fs.constants.COPYFILE_EXCL,
    );
  }
  const staged = path.join(directory, `replacement-${previous.request_id}.json`);
  let replacement;
  if (fs.existsSync(staged)) {
    replacement = JSON.parse(fs.readFileSync(staged, 'utf8'));
    assert.deepEqual(replacement.retry.parameters, config.parameters, '补跑恢复参数不一致');
    assert.equal(replacement.retry.timeout_ms, config.timeoutMs, '补跑恢复超时不一致');
  } else {
    const input = caseMessages(previous.case_id);
    replacement = await requester(config, row.metadata, input);
    replacement.retry = {
      previous_request_id: previous.request_id,
      previous_record: path.relative(runRoot, original),
      source_revision: sourceRevision,
      parameters: config.parameters,
      timeout_ms: config.timeoutMs,
      response_header_timeout_ms: Number(process.env.REQUEST_TIMEOUT_MS ?? 600000),
    };
    writeJSON(staged, replacement);
  }
  assert.equal(replacement.model_id, model.id);
  for (const key of ['case_id', 'prompt_sha256', 'image_sha256', 'gold_sha256']) {
    assert.equal(replacement[key], row.metadata[key], `补跑记录不匹配 ${key}`);
  }
  assert.equal(replacement.answer_sha256, hash(replacement.output));
  assert.equal(replacement.retry.previous_request_id, previous.request_id);
  const review = path.join(runRoot, 'reviews', modelKey(model.id), `${previous.case_id}.json`);
  for (const file of [review, review.replace(/\.json$/, '.error.json')]) {
    if (fs.existsSync(file)) {
      const archive = path.join(directory, `${previous.request_id}-${path.basename(file)}`);
      if (!fs.existsSync(archive)) {
        fs.copyFileSync(file, archive, fs.constants.COPYFILE_EXCL);
      }
      fs.unlinkSync(file);
    }
  }
  writeJSON(candidatePath(runRoot, model.id, previous.case_id), replacement);
  return {
    status: replacement.status,
    case_id: replacement.case_id,
    request_id: replacement.request_id,
  };
}
