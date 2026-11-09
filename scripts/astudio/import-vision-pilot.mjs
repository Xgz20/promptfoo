import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { hash, LOCAL, ROOT } from './vision/files.mjs';

// One-time import from the previously verified export. No source file is edited.
// Historical model outputs and original reports remain under ignored .local/.
const source = process.argv[2] && path.resolve(process.argv[2]);
assert.ok(
  source,
  'Usage: node scripts/astudio/import-vision-pilot.mjs /path/to/eval-harness/integrations/promptfoo-vision',
);
const parse = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const sourceRepo = path.resolve(source, '../..');
const original = parse(path.join(source, 'dataset/manifest.json'));
const sourceCases = fs.readFileSync(path.join(source, 'dataset/cases.jsonl'));
assert.equal(hash(sourceCases), original.cases_sha256);
const rows = sourceCases.toString('utf8').trim().split('\n').map(JSON.parse);
assert.equal(rows.length, 100);
assert.equal(new Set(rows.map((r) => r.metadata.case_id)).size, 100);
const relocate = (p) => p.replace(/^dataset\/assets\//, 'images/').replace(/^dataset\//, '');
for (const folder of ['assets', 'prompts', 'gold', 'contracts']) {
  fs.cpSync(
    path.join(source, 'dataset', folder),
    path.join(ROOT, folder === 'assets' ? 'images' : folder),
    { recursive: true },
  );
}
const sources = original.sources.map((s) => ({
  ...s,
  files: s.files.map((f) => {
    const exportPath = relocate(f.export_path);
    assert.equal(hash(fs.readFileSync(path.join(ROOT, exportPath))), f.sha256);
    return { ...f, export_path: exportPath };
  }),
}));
for (const row of rows) {
  for (const key of ['image', 'question']) {
    row.vars[key] = 'file://' + relocate(row.vars[key].slice(7));
  }
  for (const key of ['gold_path', 'schema_path', 'manifest_path']) {
    row.metadata[key] = relocate(row.metadata[key]);
  }
  const gold = parse(path.join(ROOT, row.metadata.gold_path));
  const manifest = parse(path.join(ROOT, row.metadata.manifest_path));
  const task = manifest.tasks.find((t) => t.id === row.metadata.case_id);
  row.metadata.source_dataset_version = row.metadata.dataset_version;
  row.metadata.dataset_version = 'astudio-v1';
  row.metadata.sample_id = row.metadata.case_id;
  row.metadata.applicable_dimensions = row.metadata.has_annotations
    ? gold.dimension_rubric.filter((r) => r.applicable).map((r) => r.dimension)
    : task.applicable_dimensions;
}
const serialize = (selected) => selected.map((r) => JSON.stringify(r)).join('\n') + '\n';
fs.writeFileSync(path.join(ROOT, 'cases.jsonl'), serialize(rows));
const scenes = original.scenes.map(({ weights, ...s }) => ({
  ...s,
  historical_dimension_weights: weights,
  manifest_path: relocate(s.manifest_path),
}));
for (const scene of scenes) {
  fs.writeFileSync(
    path.join(ROOT, `${scene.id}.jsonl`),
    serialize(rows.filter((r) => r.metadata.scene === scene.id)),
  );
}
write(path.join(ROOT, 'manifest.json'), {
  ...original,
  dataset_version: 'astudio-v1',
  scoring_policy_path: 'scoring-policy.json',
  scoring_policy_sha256: hash(fs.readFileSync(path.join(ROOT, 'scoring-policy.json'))),
  source_cases_sha256: original.cases_sha256,
  cases_sha256: hash(Buffer.from(serialize(rows))),
  source_export: 'eval-harness/integrations/promptfoo-vision',
  scenes,
  sources,
});

fs.cpSync(path.join(source, 'replay-data'), path.join(LOCAL, 'replay-data'), { recursive: true });
const history = parse(path.join(LOCAL, 'replay-data/manifest.json'));
const referenceDir = path.join(LOCAL, 'references');
fs.mkdirSync(referenceDir, { recursive: true });
const originalReports = new Map();
for (const key of ['deepseek', 'sol']) {
  for (const item of history.models[key]) {
    const fixture = parse(path.join(LOCAL, 'replay-data', key, `${item.case_id}.json`));
    const answer = fs.readFileSync(path.join(sourceRepo, item.source_answer));
    assert.equal(hash(answer), item.answer_sha256);
    assert.equal(hash(fixture.raw_answer), item.answer_sha256);
    const report = fs.readFileSync(path.join(sourceRepo, fixture.source_report));
    assert.equal(hash(report), fixture.source_report_sha256);
    const name = `${fixture.source_report_sha256}.json`;
    fs.writeFileSync(path.join(referenceDir, name), report);
    originalReports.set(fixture.source_report, name);
  }
}
const summary = fs.readFileSync(path.join(sourceRepo, history.published_summary_path));
assert.equal(hash(summary), history.published_summary_sha256);
fs.writeFileSync(path.join(referenceDir, 'summary.json'), summary);
write(path.join(LOCAL, 'reference-manifest.json'), {
  reports: Object.fromEntries(originalReports),
  published_summary_sha256: history.published_summary_sha256,
  original_summary_path: history.published_summary_path,
});
console.log(
  JSON.stringify({
    tasks: rows.length,
    byte_identical_core_files: sources.flatMap((s) => s.files).length,
    historical_answers_in_local: 200,
    dataset: ROOT,
    local: LOCAL,
  }),
);
