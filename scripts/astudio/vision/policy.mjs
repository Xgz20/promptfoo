import assert from 'node:assert/strict';

import { read, verifiedJSON } from './files.mjs';

const dataset = read('manifest.json');
export const SCORING_POLICY = verifiedJSON(
  dataset.scoring_policy_path,
  dataset.scoring_policy_sha256,
);
assert.equal(SCORING_POLICY.version, 'point-mean-v1');
assert.equal(SCORING_POLICY.task_score, 'equal_applicable_points');
assert.deepEqual(SCORING_POLICY.semantic_point_credit, [0, 1]);
assert.deepEqual(SCORING_POLICY.geometry_point_credit, [0, 1]);
assert.equal(SCORING_POLICY.geometry_points_per_target, 1);
assert.equal(SCORING_POLICY.shared_points, 'count_once_at_declared_owner');
assert.equal(SCORING_POLICY.extra_edit_penalty_per_item, 10);
assert.equal(SCORING_POLICY.score_floor, 0);
assert.equal(SCORING_POLICY.overall_aggregation, 'equal_weight_six_scenes');
assert.equal(SCORING_POLICY.dimension_aggregation, 'mean_applicable_task_rates');
assert.equal(SCORING_POLICY.annotation_aggregation, 'pooled_complete_annotations');
assert.equal(SCORING_POLICY.legacy_contract_weights, 'historical_reference_only');
