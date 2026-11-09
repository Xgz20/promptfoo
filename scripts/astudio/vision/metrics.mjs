import assert from 'node:assert/strict';

import { pivotCaseDetails } from './case-details.mjs';
import { DIMENSIONS } from './score.mjs';

const sum = (values) => values.reduce((total, value) => total + value, 0);
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);

function completeMean(records, getter) {
  const values = records.map(getter);
  return values.length && values.every(numeric) ? sum(values) / values.length : null;
}

export function summarize(records) {
  const graded = records.filter((record) => numeric(record.result?.score));
  return {
    planned: records.length,
    graded: graded.length,
    score: completeMean(records, (record) => record.result?.score),
    latency_seconds: completeMean(records, (record) =>
      numeric(record.candidate?.elapsed_ms) ? record.candidate.elapsed_ms / 1000 : null,
    ),
    input_tokens: completeMean(records, (record) => record.cost?.usage.input),
    output_tokens: completeMean(records, (record) => record.cost?.usage.output),
    total_tokens: completeMean(records, (record) => record.cost?.usage.total),
    estimated_cost: completeMean(records, (record) => record.cost?.amount),
    failed_calls: records.filter((record) => record.candidate && record.candidate.status !== 'ok')
      .length,
    invalid_configuration_calls: records.filter(
      (record) => record.candidate?.status === 'invalid_configuration',
    ).length,
    pending_calls: records.filter((record) => !record.candidate).length,
    pending_judgments: records.filter(
      (record) => record.candidate?.status === 'ok' && !record.result,
    ).length,
  };
}

export function capabilityMetrics(records) {
  const metrics = DIMENSIONS.map((dimension) => {
    const applicable = records.filter((record) => record.applicable_points[dimension] > 0);
    const possible = sum(applicable.map((record) => record.applicable_points[dimension]));
    const complete = applicable.every((record) =>
      numeric(record.result?.dimensions[dimension]?.earned),
    );
    const earned = complete
      ? sum(applicable.map((record) => record.result.dimensions[dimension].earned))
      : null;
    return {
      name: dimension,
      applicable_tasks: applicable.length,
      earned,
      possible,
      rate: possible && complete ? earned / possible : null,
      aggregation: '检查点汇总正确率',
    };
  });
  const annotated = records.filter((record) => record.annotation_count > 0);
  const annotations = sum(annotated.map((record) => record.annotation_count));
  const complete = annotated.every((record) => numeric(record.result?.annotation_complete_count));
  const correct = complete
    ? sum(annotated.map((record) => record.result.annotation_complete_count))
    : null;
  metrics.push({
    name: '批注完整正确率',
    applicable_tasks: annotated.length,
    earned: correct,
    possible: annotations,
    rate: annotations && complete ? correct / annotations : null,
    aggregation: '完整正确批注数 / 标准批注数',
  });
  return metrics;
}

export function buildReport({ manifest, config, pricing, records }) {
  const expected = new Set();
  const caseIds = new Set(manifest.case_ids);
  assert.equal(caseIds.size, manifest.case_ids.length, '计划题号重复');
  for (const model of manifest.models) {
    for (const id of caseIds) {
      expected.add(`${model.id}\n${id}`);
    }
  }
  assert.equal(records.length, expected.size, '逐题记录数量不匹配');
  const seen = new Set();
  for (const record of records) {
    const key = `${record.model_id}\n${record.case_id}`;
    assert.ok(expected.has(key), `计划外结果 ${key}`);
    assert.ok(!seen.has(key), `重复结果 ${key}`);
    seen.add(key);
    assert.ok(
      manifest.scenes.some((scene) => scene.id === record.scene),
      '未知场景',
    );
    for (const dimension of DIMENSIONS) {
      const possible = record.applicable_points[dimension];
      assert.ok(Number.isInteger(possible) && possible >= 0, '检查点分母无效');
      if (record.result) {
        const result = record.result.dimensions[dimension];
        assert.equal(result.possible, possible, '实际与计划检查点数不一致');
        assert.ok(
          Number.isInteger(result.earned) && result.earned >= 0 && result.earned <= possible,
          '检查点得分无效',
        );
      }
    }
  }
  const overall = manifest.models.map((model) => {
    const selected = records.filter((record) => record.model_id === model.id);
    return { model_id: model.id, name: model.name, ...summarize(selected) };
  });
  const scenes = manifest.scenes.flatMap((scene) =>
    manifest.models.map((model) => ({
      scene_id: scene.id,
      scene_name: scene.name,
      model_id: model.id,
      name: model.name,
      ...summarize(
        records.filter((record) => record.model_id === model.id && record.scene === scene.id),
      ),
    })),
  );
  const byModel = manifest.models.map((model) => ({
    model,
    metrics: capabilityMetrics(records.filter((record) => record.model_id === model.id)),
  }));
  const capabilities = [...DIMENSIONS, '批注完整正确率'].flatMap((dimension) =>
    byModel.map(({ model, metrics }) => ({
      model_id: model.id,
      model_name: model.name,
      ...metrics.find((metric) => metric.name === dimension),
    })),
  );
  return {
    report_version: 'vision-selection-report-v1',
    generated_at: new Date().toISOString(),
    run_id: manifest.run_id,
    scope: manifest.scope,
    dataset_version: manifest.dataset_version,
    dataset_size: manifest.dataset_size,
    selected_cases: manifest.case_ids.length,
    source_revision: manifest.source_revision,
    source_dirty: manifest.source_dirty ?? false,
    formulas: {
      overall: '各题最终分之和 / 计划题数',
      scene: '场景内各题最终分之和 / 场景计划题数',
      capability: '正确检查点数 / 全部适用检查点数',
      annotation: '全部检查点正确的批注数 / 标准批注数',
    },
    cost_method: 'Venus 实时 API 公开单价估算，包含接口计入的推理 token，裁判费用单独记录',
    sources: {
      metrics: config.metrics_source,
      models: config.source,
      pricing: pricing.sources,
      pricing_as_of: pricing.as_of,
    },
    overall,
    scenes,
    capabilities,
    case_details: pivotCaseDetails(records, manifest.models),
    records,
    pricing,
  };
}
