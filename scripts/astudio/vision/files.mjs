import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ROOT = path.join(REPO, 'datasets/vision/astudio-v1');
export const LOCAL = path.join(REPO, '.local/vision-astudio-v1');
export const hash = (data) => createHash('sha256').update(data).digest('hex');
export const localPath = (relative) => {
  assert.equal(typeof relative, 'string');
  const p = path.resolve(ROOT, relative.replace(/^file:\/\//, ''));
  assert.ok(p.startsWith(ROOT + path.sep), 'Path must stay in the dataset directory');
  return p;
};
export const bytes = (relative) => fs.readFileSync(localPath(relative));
export const read = (relative) => JSON.parse(bytes(relative).toString('utf8'));
export function verifiedJSON(relative, sha) {
  const b = bytes(relative);
  assert.equal(hash(b), sha, `HASH_MISMATCH: ${relative}`);
  return JSON.parse(b.toString('utf8'));
}
export function fixtureFor(history, caseId) {
  assert.match(history, /^(deepseek|sol)$/);
  assert.match(caseId, /^(canvas|webapp|photo|poster|chart|document)-\d{3}$/);
  const file = path.join(LOCAL, 'replay-data', history, `${caseId}.json`);
  assert.ok(
    fs.existsSync(file),
    'HISTORICAL_ANSWER_REQUIRED: import replay data into .local first; see the dataset README',
  );
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
