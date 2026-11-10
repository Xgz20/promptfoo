import assert from 'node:assert/strict';

import { test } from 'vitest';
import { chat } from '../../scripts/astudio/vision/chat.mjs';

const options = {
  baseUrl: 'https://example.com/v1',
  model: 'test/model',
  apiKey: 'capture-secret',
  messages: [],
  captureResponse: true,
};

test('diagnostics retain full reasoning, original content structure and usage with credential redaction', async () => {
  const body = {
    model: 'test/model',
    usage: { completion_tokens: 32768 },
    choices: [
      {
        finish_reason: 'length',
        message: { content: '', reasoning_content: '完整思考内容 capture-secret' },
      },
    ],
  };
  const result = await chat({
    ...options,
    fetcher: async (_url, init) => {
      assert.equal(init.disableTransientRetries, true);
      return new Response(JSON.stringify(body), {
        headers: { 'set-cookie': 'private-cookie', 'x-request-id': 'test-id' },
      });
    },
  });
  const raw = JSON.parse(result.raw_response.body);
  assert.equal(raw.choices[0].message.reasoning_content, '完整思考内容 [REDACTED]');
  assert.equal(result.raw_response.headers['set-cookie'], '[REDACTED]');
  assert.equal(result.raw_response.headers['x-request-id'], 'test-id');
  assert.equal(result.raw_response.complete, true);
  assert.equal(result.raw_response.json_valid, true);
  assert.equal(result.output, '');
  assert.equal(result.usage.completion_tokens, 32768);
});

test('diagnostics preserve malformed response bodies and HTTP status', async () => {
  const result = await chat({
    ...options,
    fetcher: async () => new Response('{"secret":"capture-secret"', { status: 200 }),
  });
  assert.ok(result.error);
  assert.equal(result.http_status, 200);
  assert.equal(result.raw_response.body, '{"secret":"[REDACTED]"');
  assert.equal(result.raw_response.complete, true);
  assert.equal(result.raw_response.json_valid, false);
});

test('diagnostics retain already received body chunks when transport reading fails', async () => {
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (reads++ === 0) {
        controller.enqueue(new TextEncoder().encode('partial capture-secret'));
      } else {
        controller.error(new Error('body interrupted'));
      }
    },
  });
  const result = await chat({ ...options, fetcher: async () => new Response(body) });
  assert.equal(result.raw_response.body, 'partial [REDACTED]');
  assert.equal(result.raw_response.complete, false);
  assert.equal(result.raw_response.json_valid, false);
  assert.match(result.error, /interrupted/);
});
