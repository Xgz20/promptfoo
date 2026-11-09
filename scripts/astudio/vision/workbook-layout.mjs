import assert from 'node:assert/strict';

import { DIMENSIONS } from './score.mjs';

export const CALCULATION_FIELDS = [
  'earned',
  'possible',
  'penalty',
  'latency',
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'cache_read',
  'cache_write',
  'ordinary_input',
  'price_key',
  'cost',
  'unit_input',
  'unit_output',
  'unit_cache_read',
  'unit_cache_write',
  ...DIMENSIONS.flatMap((_dimension, index) => [
    `dimension_${index}_earned`,
    `dimension_${index}_possible`,
  ]),
  'annotation_earned',
  'annotation_possible',
];

export function excelColumn(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < 16384, 'Excel 列索引越界');
  let column = '',
    value = index + 1;
  while (value > 0) {
    value--;
    column = String.fromCharCode(65 + (value % 26)) + column;
    value = Math.floor(value / 26);
  }
  return column;
}

export function caseColumnPlan(models) {
  const visibleHeaders = ['用例 ID', '场景', '用例名称', '检查点'];
  for (const model of models) {
    visibleHeaders.push(`${model.name}\n得分（百分制）`, `${model.name}\n检查点得分明细（0/1）`);
  }
  const auxiliaryFirst = visibleHeaders.length + 1;
  const sceneColumn = auxiliaryFirst;
  let next = sceneColumn + 1;
  const modelColumns = models.map((model, index) => ({
    model_id: model.model_id ?? model.id,
    score: 5 + index * 2,
    points: 6 + index * 2,
    fields: Object.fromEntries(CALCULATION_FIELDS.map((field) => [field, next++])),
  }));
  assert.ok(next <= 16384, '模型数量超过工作簿列容量');
  return {
    visibleHeaders,
    visibleLast: visibleHeaders.length,
    auxiliaryFirst,
    sceneColumn,
    modelColumns,
    lastColumn: next - 1,
  };
}

function textUnits(text) {
  return [...text].reduce(
    (units, character) => units + (character.codePointAt(0) > 255 ? 2 : 1),
    0,
  );
}

export function compactLines(items, unitsPerLine) {
  const lines = [];
  let current = '';
  for (const item of items) {
    const combined = current ? `${current}    ${item}` : item;
    if (current && textUnits(combined) > unitsPerLine) {
      lines.push(current);
      current = item;
    } else {
      current = combined;
    }
  }
  if (current) {
    lines.push(current);
  }
  return {
    text: lines.join('\n'),
    lineCount: lines.reduce(
      (count, line) => count + Math.max(1, Math.ceil(textUnits(line) / unitsPerLine)),
      0,
    ),
  };
}

export function hideColumnDefinitions(xml, first, last) {
  let hidden = 0;
  const result = xml.replace(/<(?:[A-Za-z_]\w*:)?col\b[^>]*\/>/g, (tag) => {
    const min = Number(tag.match(/\bmin="(\d+)"/)?.[1]);
    const max = Number(tag.match(/\bmax="(\d+)"/)?.[1]);
    if (max < first || min > last || !Number.isFinite(min) || !Number.isFinite(max)) {
      return tag;
    }
    const part = (start, end, hide) => {
      const updated = tag
        .replace(/\bmin="\d+"/, `min="${start}"`)
        .replace(/\bmax="\d+"/, `max="${end}"`);
      return hide
        ? updated.replace(/\s+hidden="[^"]*"/, '').replace('/>', ' hidden="1"/>')
        : updated;
    };
    const parts = [];
    if (min < first) {
      parts.push(part(min, first - 1, false));
    }
    parts.push(part(Math.max(min, first), Math.min(max, last), true));
    hidden += Math.min(max, last) - Math.max(min, first) + 1;
    if (max > last) {
      parts.push(part(last + 1, max, false));
    }
    return parts.join('');
  });
  assert.equal(hidden, last - first + 1, '计算辅助列的原生列定义不完整');
  return result;
}
