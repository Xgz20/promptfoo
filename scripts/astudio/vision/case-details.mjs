import assert from 'node:assert/strict';

import { DIMENSIONS, semanticCheckpoints } from './score.mjs';

export function checkpointDefinitions(gold) {
  const semantic = semanticCheckpoints(gold).map((point) => ({ ...point, kind: 'semantic' }));
  const geometry = gold.annotations.length
    ? gold.annotations.map((annotation) => {
        const rule = annotation.geometry;
        const ids = annotation.rubric.find(
          (rubric) => rubric.dimension === DIMENSIONS[5],
        )?.checkpoint_ids;
        return {
          id: ids?.length === 1 ? ids[0] : `${annotation.id}.point`,
          dimension: DIMENSIONS[5],
          kind: 'geometry',
          target_id: annotation.id,
          expected:
            rule.type === 'bbox'
              ? `代表点换算为输入像素后落在批注${annotation.id}目标框${JSON.stringify(rule.bbox_xyxy)}内，包含边界`
              : `代表点换算为输入像素后到批注${annotation.id}目标折线的最短距离不超过${rule.max_distance_px}像素`,
        };
      })
    : Object.entries(gold.geometry ?? {}).map(([id, rule]) => ({
        id: `${id}.point`,
        dimension: DIMENSIONS[5],
        kind: 'geometry',
        target_id: id,
        expected: `${rule.scope ?? id}的代表点距可见框中心不超过${rule.tolerance_input_px}输入像素`,
      }));
  const points = [...semantic, ...geometry];
  assert.equal(new Set(points.map((point) => point.id)).size, points.length, '检查点 ID 重复');
  return points;
}

export function checkpointResults(definitions, result, review) {
  if (!result) {
    return definitions.map((point) => ({ ...point, credit: null, reason: '待评分' }));
  }
  const semantic = new Map(review.checkpoints.map((point) => [point.id, point]));
  const points = definitions.map((point) => {
    if (point.kind === 'semantic') {
      const decision = semantic.get(point.id);
      assert.ok(
        decision && (decision.credit === 0 || decision.credit === 1),
        `缺少二值判分 ${point.id}`,
      );
      return { ...point, credit: decision.credit, reason: decision.reason ?? '' };
    }
    const geometry = result.geometry.find(
      (item) => (item.annotation_id ?? item.question_id) === point.target_id,
    );
    assert.ok(geometry, `缺少几何判分 ${point.id}`);
    const credit = Number(result.status === 'ok' && geometry.geometric_hit);
    return {
      ...point,
      credit,
      reason: credit ? '位置满足几何规则' : '位置未满足几何规则或候选调用失败',
    };
  });
  assert.equal(points.length, result.total_points, '用例明细与单题检查点分母不一致');
  assert.equal(
    points.reduce((sum, point) => sum + point.credit, 0),
    result.earned_points,
    '用例明细与单题正确检查点数不一致',
  );
  return points;
}

export function pivotCaseDetails(records, models) {
  const grouped = new Map();
  for (const record of records) {
    const entry = grouped.get(record.case_id) ?? [];
    entry.push(record);
    grouped.set(record.case_id, entry);
  }
  return [...grouped].map(([id, entries]) => {
    assert.equal(entries.length, models.length, `用例模型记录数量不一致 ${id}`);
    assert.equal(
      new Set(entries.map((entry) => entry.model_id)).size,
      models.length,
      `用例模型记录重复 ${id}`,
    );
    const first = entries[0];
    const definitions = (first.checkpoints ?? []).map(
      ({ credit: _credit, reason: _reason, ...point }) => point,
    );
    return {
      case_id: id,
      name: first.case_name ?? id,
      scene: first.scene,
      checkpoints: definitions,
      models: models.map((model) => {
        const record = entries.find((entry) => entry.model_id === model.id);
        assert.ok(record, `缺少模型用例记录 ${model.id} ${id}`);
        assert.equal(record.scene, first.scene, '模型间用例场景不一致');
        const points = record.checkpoints ?? [];
        assert.deepEqual(
          points.map(({ credit: _credit, reason: _reason, ...point }) => point),
          definitions,
          '模型间标准检查点不一致',
        );
        return {
          model_id: model.id,
          model_name: model.name,
          score: record.result?.score ?? null,
          base_score: record.result?.base_score ?? null,
          extra_edit_penalty: record.result?.extra_edit_penalty ?? null,
          earned_points: record.result?.earned_points ?? null,
          total_points: points.length,
          checkpoints: points.map(({ id, credit, reason }) => ({ id, credit, reason })),
        };
      }),
    };
  });
}
