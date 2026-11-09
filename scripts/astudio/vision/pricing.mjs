import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { fetchForVision } from './network.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const perMillion = (value) => (value == null ? null : Number((Number(value) * 1e6).toFixed(8)));

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { input: null, output: null, total: null, cache_read: 0, cache_write: 0 };
  }
  const input = finite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const output = finite(usage.completion_tokens) ? usage.completion_tokens : null;
  const total = finite(usage.total_tokens)
    ? usage.total_tokens
    : input !== null && output !== null
      ? input + output
      : null;
  const cacheRead =
    usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0;
  const cacheWrite =
    usage.prompt_tokens_details?.cache_creation_tokens ?? usage.cache_creation_input_tokens ?? 0;
  return {
    input,
    output,
    total,
    cache_read: finite(cacheRead) ? cacheRead : null,
    cache_write: finite(cacheWrite) ? cacheWrite : null,
    reported_cost: finite(usage.cost) ? usage.cost : null,
  };
}

export function priceRows(snapshot) {
  return snapshot.models.flatMap((model) =>
    model.pricing_rules.flatMap((rule) =>
      rule.rates.map((rate) => ({
        key: `price_${createHash('sha256')
          .update(JSON.stringify([model.id, rule.pricing_row_id, rate.rate_key]))
          .digest('hex')
          .slice(0, 24)}`,
        pricing_row_id: rule.pricing_row_id,
        model_id: model.id,
        model_name: model.name,
        provider_id: rule.provider_id,
        providers: rule.applies_to_provider_ids,
        provider_name: rule.provider_name ?? rule.applies_to_provider_ids.join(', '),
        billing_mode: rule.billing_mode,
        currency: rule.currency,
        region: rule.region,
        tier: rule.tier_key,
        min_tokens: rule.tier_min_tokens,
        max_tokens: rule.tier_max_tokens,
        rate_key: rate.rate_key,
        rate_label: rate.rate_label,
        windows: rate.windows,
        timezone: rule.timezone ?? 'Asia/Shanghai',
        default_rate: rate.is_default,
        input: perMillion(rate.pricing.input),
        output: perMillion(rate.pricing.output),
        cache_read: perMillion(rate.pricing.cache?.read),
        cache_write: perMillion(rate.pricing.cache?.write ?? rate.pricing.cache?.write_5m),
        cache_write_ttl: rate.pricing.cache?.write_5m == null ? null : '5分钟',
        effective_from: rule.effective_from ?? null,
        effective_to: rule.effective_to ?? null,
        notes: rate.pricing.notes ?? '',
        as_of: snapshot.as_of,
      })),
    ),
  );
}

function inWindow(window, timestamp, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  const time = Number(parts.hour) * 60 + Number(parts.minute);
  const minutes = (text) =>
    text
      .split(':')
      .reduce((hours, value, index) => hours + Number(value) * (index === 0 ? 60 : 1), 0);
  const start = minutes(window.start),
    end = minutes(window.end);
  return start <= end ? time >= start && time < end : time >= start || time < end;
}

export function estimateCost(snapshot, record) {
  const usage = normalizeUsage(record.usage);
  const unavailable = (reason) => ({ amount: null, price_key: null, reason, usage });
  if (
    [usage.input, usage.output, usage.cache_read, usage.cache_write].some((value) => value === null)
  ) {
    return unavailable('缺少完整用量');
  }
  if (usage.cache_read + usage.cache_write > usage.input) {
    return unavailable('缓存用量超过输入用量');
  }
  const timestamp = Date.parse(record.started_at);
  if (!Number.isFinite(timestamp)) {
    return unavailable('缺少调用时间');
  }
  let candidates = priceRows(snapshot).filter(
    (row) =>
      row.model_id === record.model_id &&
      row.billing_mode === 'on_demand' &&
      row.currency === 'CNY' &&
      (!record.provider || row.providers.includes(record.provider)) &&
      usage.input >= row.min_tokens &&
      (!row.max_tokens || usage.input <= row.max_tokens) &&
      (!row.effective_from || timestamp >= Date.parse(row.effective_from)) &&
      (!row.effective_to || timestamp < Date.parse(row.effective_to)),
  );
  if (record.provider && candidates.some((row) => row.provider_id === record.provider)) {
    candidates = candidates.filter((row) => row.provider_id === record.provider);
  }
  const active = candidates.filter((row) =>
    row.windows.some((window) => inWindow(window, record.started_at, row.timezone)),
  );
  candidates = active.length ? active : candidates.filter((row) => row.default_rate);
  if (candidates.length !== 1) {
    return unavailable(candidates.length ? '计价渠道不唯一' : '缺少匹配的实时单价');
  }
  const rate = candidates[0];
  const ordinaryInput = usage.input - usage.cache_read - usage.cache_write;
  const inputs = [
    [ordinaryInput, rate.input],
    [usage.output, rate.output],
    [usage.cache_read, rate.cache_read],
    [usage.cache_write, rate.cache_write],
  ];
  if (inputs.some(([tokens, price]) => tokens > 0 && !finite(price))) {
    return unavailable('已使用的计费项缺少单价');
  }
  const amount = inputs.reduce((sum, [tokens, price]) => sum + (tokens * (price ?? 0)) / 1e6, 0);
  assert.ok(Number.isFinite(amount) && amount >= 0);
  return {
    amount,
    price_key: rate.key,
    pricing_row_id: rate.pricing_row_id,
    rate_key: rate.rate_key,
    reason: null,
    usage,
  };
}

export async function refreshPricing(models, fetcher = fetchForVision) {
  const url = 'https://venus.xfinfr.com/public/models';
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, `获取 Venus 价格失败 HTTP ${response.status}`);
  const catalog = await response.json();
  const selected = models.map(({ id }) => {
    const model = catalog.data.find((item) => item.id === id);
    assert.ok(model?.pricing_rules?.length, `缺少模型价格 ${id}`);
    assert.ok(model.architecture?.input_modalities?.includes('image'), `模型未声明图片输入 ${id}`);
    return Object.fromEntries(
      ['id', 'name', 'pricing_rules', 'providers', 'architecture'].map((key) => [key, model[key]]),
    );
  });
  return {
    schema_version: 1,
    as_of: catalog.pricing_as_of,
    sources: ['https://venus.xunfei.cn/pricing', url],
    models: selected,
  };
}
