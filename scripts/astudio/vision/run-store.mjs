import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { checkpointDefinitions, checkpointResults } from './case-details.mjs';
import { bytes, hash, read, verifiedJSON } from './files.mjs';
import { reviewPath, reviewRequest, scoreCandidate, technicalFailureReview } from './judge.mjs';
import { readCandidate } from './live-provider.mjs';
import { buildReport } from './metrics.mjs';
import { estimateCost } from './pricing.mjs';
import { DIMENSIONS } from './score.mjs';

export function datasetCases() {
  return bytes('cases.jsonl').toString('utf8').trim().split('\n').map(JSON.parse);
}

export function plannedPoints(row) {
  const gold = verifiedJSON(row.metadata.gold_path, row.metadata.gold_sha256);
  const points = checkpointDefinitions(gold);
  return {
    applicable_points: Object.fromEntries(
      DIMENSIONS.map((dimension) => [
        dimension,
        points.filter((point) => point.dimension === dimension).length,
      ]),
    ),
    annotation_count: gold.annotations.length,
    checkpoint_definitions: points,
  };
}

export function loadRun(runRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'));
  const pricing = JSON.parse(fs.readFileSync(path.join(runRoot, 'pricing.json'), 'utf8'));
  const config = manifest.config;
  assert.equal(hash(bytes('cases.jsonl')), manifest.cases_sha256, '运行后的 JSONL 已经改变');
  assert.equal(hash(JSON.stringify(pricing)), manifest.pricing_sha256, '运行价格快照已经改变');
  const rows = datasetCases().filter((row) => manifest.case_ids.includes(row.metadata.case_id));
  assert.equal(rows.length, manifest.case_ids.length, '当前题集与运行记录不匹配');
  assert.equal(read('manifest.json').cases_sha256, manifest.cases_sha256, '运行后的题集已经改变');
  const jobs = [];
  const records = [];
  for (const model of manifest.models) {
    for (const row of rows) {
      const id = row.metadata.case_id;
      const candidate = readCandidate(runRoot, model.id, row.metadata);
      let result = null,
        reviewError = null,
        provenance = null,
        semanticReview = null;
      if (candidate) {
        const request = reviewRequest(row, candidate);
        jobs.push({ row, candidate });
        const file = reviewPath(runRoot, model.id, id);
        if (candidate.status === 'error') {
          semanticReview = technicalFailureReview(request);
          result = scoreCandidate(row, candidate, semanticReview);
          provenance = { mode: 'technical_failure_rule' };
        } else if (candidate.status === 'ok' && fs.existsSync(file)) {
          const reviewed = JSON.parse(fs.readFileSync(file, 'utf8'));
          semanticReview = reviewed.review;
          result = scoreCandidate(row, candidate, semanticReview);
          provenance = reviewed.provenance;
        }
        const errorFile = file.replace(/\.json$/, '.error.json');
        if (!result && fs.existsSync(errorFile)) {
          reviewError = JSON.parse(fs.readFileSync(errorFile, 'utf8')).error;
        }
      }
      const { checkpoint_definitions: definitions, ...planned } = plannedPoints(row);
      records.push({
        model_id: model.id,
        model_name: model.name,
        case_id: id,
        case_name: row.description,
        scene: row.metadata.scene,
        ...planned,
        checkpoints: checkpointResults(definitions, result, semanticReview),
        candidate,
        result,
        review_error: reviewError,
        judge_provenance: provenance,
        cost: candidate ? estimateCost(pricing, candidate) : null,
      });
    }
  }
  return { manifest, pricing, config, jobs, records };
}

export function reportForRun(runRoot) {
  return buildReport(loadRun(runRoot));
}
