import { randomUUID } from 'node:crypto';

import { fetchForVision } from './network.mjs';

export async function chat({
  baseUrl,
  model,
  apiKey,
  messages,
  parameters = {},
  timeoutMs = 600000,
  fetcher = fetchForVision,
}) {
  if (!apiKey) {
    throw new Error('缺少 API 密钥环境变量');
  }
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const requestId = randomUUID();
  let response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Client-Request-Id': requestId,
      },
      body: JSON.stringify({ model, messages, stream: false, ...parameters }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    const error = response.ok
      ? null
      : JSON.stringify(data.error ?? data).replaceAll(apiKey, '[REDACTED]');
    return {
      request_id: requestId,
      server_request_id: data.venus_request_id ?? response.headers.get('x-request-id'),
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      elapsed_ms: performance.now() - start,
      http_status: response.status,
      model_id: model,
      returned_model: data.model ?? null,
      error_code: data.error?.code ?? null,
      provider: data.provider ?? null,
      usage: data.usage ?? null,
      output:
        typeof data.choices?.[0]?.message?.content === 'string'
          ? data.choices[0].message.content
          : '',
      finish_reason: data.choices?.[0]?.finish_reason ?? null,
      error,
    };
  } catch (error) {
    return {
      request_id: requestId,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      elapsed_ms: performance.now() - start,
      http_status: response?.status ?? null,
      model_id: model,
      usage: null,
      output: '',
      error: error.message.replaceAll(apiKey, '[REDACTED]'),
      error_code: error.cause?.code ?? error.code ?? null,
      error_cause: error.cause?.message?.replaceAll(apiKey, '[REDACTED]') ?? null,
    };
  }
}
