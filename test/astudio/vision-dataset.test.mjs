import assert from 'node:assert/strict';

import { test } from 'vitest';
import { verifyDataset } from '../../scripts/astudio/vision/verify-dataset.mjs';

test('100 imported cases preserve frozen input bytes, IDs, contracts and scene coverage', () => {
  const result = verifyDataset();
  assert.equal(result.byte_identical_core_files, 300);
  assert.deepEqual(result.applicable_dimension_counts, {
    对象属性与状态识别: 100,
    空间布局与连接关系识别: 100,
    批注目标识别: 40,
    批注意图理解: 40,
    精确坐标定位: 100,
    文字识别: 79,
  });
});
