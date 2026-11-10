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
  captureResponse = false,
}) {
  if (!apiKey) {
    throw new Error('缺少 API 密钥环境变量');
  }
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const requestId = randomUUID();
  let response;
  let rawResponse;
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
      disableTransientRetries: captureResponse ? true : undefined,
    });
    let data;
    if (captureResponse) {
      rawResponse = {
        headers: Object.fromEntries(
          [...response.headers].map(([name, value]) => [
            name,
            /authorization|cookie|api[-_]?key|token/i.test(name)
              ? '[REDACTED]'
              : value.replaceAll(apiKey, '[REDACTED]'),
          ]),
        ),
        body: '',
        received_bytes: 0,
        complete: false,
        json_valid: false,
      };
      const decoder = new TextDecoder();
      for await (const chunk of response.body ?? []) {
        rawResponse.body += decoder.decode(chunk, { stream: true });
        rawResponse.received_bytes += chunk.byteLength;
      }
      rawResponse.body += decoder.decode();
      rawResponse.body = rawResponse.body.replaceAll(apiKey, '[REDACTED]');
      rawResponse.complete = true;
      data = JSON.parse(rawResponse.body);
      rawResponse.json_valid = true;
    } else {
      data = await response.json();
    }
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
      raw_response: rawResponse,
    };
  } catch (error) {
    if (rawResponse) {
      rawResponse.body = rawResponse.body.replaceAll(apiKey, '[REDACTED]');
    }
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
      raw_response: rawResponse,
    };
  }
}
