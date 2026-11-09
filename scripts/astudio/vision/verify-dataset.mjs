import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { bytes, hash, read, verifiedJSON } from './files.mjs';
import { SCORING_POLICY } from './policy.mjs';

export function verifyDataset() {
  const manifest = read('manifest.json');
  assert.equal(hash(bytes('cases.jsonl')), manifest.cases_sha256);
  const rows = bytes('cases.jsonl').toString('utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map((r) => r.vars.case_id)).size, 100);
  assert.deepEqual(
    manifest.scenes.map((s) => s.count),
    [20, 20, 15, 15, 15, 15],
  );
  let files = 0;
  for (const source of manifest.sources) {
    for (const f of source.files) {
      assert.equal(hash(bytes(f.export_path)), f.sha256, f.export_path);
      files++;
    }
  }
  const counts = {};
  for (const row of rows) {
    const meta = row.metadata;
    assert.equal(row.vars.case_id, meta.case_id);
    assert.equal(meta.sample_id, meta.case_id);
    assert.equal(meta.dataset_version, 'astudio-v1');
    assert.equal(hash(bytes(row.vars.image)), meta.image_sha256);
    assert.equal(hash(bytes(row.vars.question)), meta.prompt_sha256);
    const gold = verifiedJSON(meta.gold_path, meta.gold_sha256);
    const contract = verifiedJSON(meta.manifest_path, meta.manifest_sha256);
    verifiedJSON(meta.schema_path, meta.schema_sha256);
    assert.equal(contract.version, meta.source_dataset_version);
    assert.equal(Boolean(gold.annotations.length), meta.has_annotations);
    const task = contract.tasks.find((t) => t.id === meta.case_id);
    const applicable = meta.has_annotations
      ? gold.dimension_rubric.filter((d) => d.applicable).map((d) => d.dimension)
      : task.applicable_dimensions;
    assert.deepEqual(meta.applicable_dimensions, applicable);
    for (const d of applicable) {
      counts[d] = (counts[d] ?? 0) + 1;
    }
  }
  for (const scene of manifest.scenes) {
    const selected = rows.filter((r) => r.metadata.scene === scene.id);
    assert.equal(selected.length, scene.count);
    assert.deepEqual(
      bytes(`${scene.id}.jsonl`).toString('utf8').trim().split('\n').map(JSON.parse),
      selected,
    );
    verifiedJSON(scene.manifest_path, scene.manifest_sha256);
  }
  assert.equal(files, 300);
  return {
    status: 'PASS',
    tasks: 100,
    images: 100,
    byte_identical_core_files: files,
    scoring_version: SCORING_POLICY.version,
    scene_counts: manifest.scenes.map((s) => s.count),
    applicable_dimension_counts: counts,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(verifyDataset(), null, 2));
}
