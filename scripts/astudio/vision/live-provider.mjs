import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chat } from './chat.mjs';
import { hash } from './files.mjs';
import { normalizeUsage } from './pricing.mjs';

export function modelKey(modelId) {
  return hash(modelId).slice(0, 16);
}

export function candidatePath(runRoot, modelId, caseId) {
  assert.match(caseId, /^(canvas|webapp|photo|poster|chart|document)-\d{3}$/);
  return path.join(runRoot, 'candidates', modelKey(modelId), `${caseId}.json`);
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

export function readCandidate(runRoot, modelId, meta) {
  const file = candidatePath(runRoot, modelId, meta.case_id);
  if (!fs.existsSync(file)) {
    return null;
  }
  const candidate = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(candidate.model_id, modelId);
  for (const key of ['case_id', 'image_sha256', 'prompt_sha256', 'gold_sha256']) {
    assert.equal(candidate[key], meta[key], `候选记录与题目不匹配 ${key}`);
  }
  assert.equal(candidate.answer_sha256, hash(candidate.output), '候选回答哈希不一致');
  return candidate;
}

export function candidateStatus(result) {
  if (
    [400, 401, 403, 404, 422].includes(result.http_status) ||
    ['model_not_found', 'invalid_api_key', 'permission_denied', 'unsupported_parameter'].includes(
      result.error_code,
    )
  ) {
    return 'invalid_configuration';
  }
  return !result.error && result.output ? 'ok' : 'error';
}

export async function requestCandidate(config, meta, messages) {
  assert.equal(messages.length, 1);
  const content = messages[0].content;
  assert.equal(content.length, 2);
  assert.equal(hash(content[0].text), meta.prompt_sha256, '候选模型题干哈希不一致');
  assert.equal(
    hash(Buffer.from(content[1].image_url.url.split(',')[1], 'base64')),
    meta.image_sha256,
    '候选模型图片哈希不一致',
  );
  const result = await chat({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: process.env[config.apiKeyEnv],
    messages,
    parameters: config.parameters,
    timeoutMs: config.timeoutMs,
    captureResponse: config.captureResponse,
  });
  return {
    ...result,
    case_id: meta.case_id,
    scene: meta.scene,
    image_sha256: meta.image_sha256,
    prompt_sha256: meta.prompt_sha256,
    gold_sha256: meta.gold_sha256,
    answer_sha256: hash(result.output),
    status: candidateStatus(result),
  };
}

export default class VisionProvider {
  constructor(options) {
    this.config = options.config;
    this.handlesOwnRetries = true;
    this.configurationError = null;
  }
  id() {
    return `venus:${this.config.model}`;
  }
  async callApi(prompt, context) {
    const meta = context.test.metadata;
    assert.equal(this.configurationError, null, this.configurationError ?? '模型配置异常');
    assert.equal(
      readCandidate(this.config.runRoot, this.config.model, meta),
      null,
      '候选记录已存在，请使用断点恢复跳过已完成调用',
    );
    const record = await requestCandidate(this.config, meta, JSON.parse(prompt));
    writeJSON(candidatePath(this.config.runRoot, this.config.model, meta.case_id), record);
    if (record.status === 'invalid_configuration') {
      this.configurationError = record.error ?? '模型配置异常';
    }
    console.log(
      JSON.stringify({ model: record.model_id, case_id: record.case_id, status: record.status }),
    );
    const usage = normalizeUsage(record.usage);
    return {
      output: record.output,
      error: record.error ?? (record.output ? undefined : 'EMPTY_MODEL_OUTPUT'),
      cached: false,
      latencyMs: record.elapsed_ms,
      tokenUsage: {
        prompt: usage.input ?? undefined,
        completion: usage.output ?? undefined,
        total: usage.total ?? undefined,
        cached: usage.cache_read ?? undefined,
      },
      metadata: { vision_candidate: record },
    };
  }
}
