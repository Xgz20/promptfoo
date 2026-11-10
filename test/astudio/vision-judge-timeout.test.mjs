import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';
import { chat } from '../../scripts/astudio/vision/chat.mjs';
import { bytes, hash, read } from '../../scripts/astudio/vision/files.mjs';
import { judgeCandidate } from '../../scripts/astudio/vision/judge.mjs';
import { semanticCheckpoints } from '../../scripts/astudio/vision/score.mjs';

vi.mock('../../scripts/astudio/vision/chat.mjs', () => ({ chat: vi.fn() }));
afterEach(() => vi.resetAllMocks());

test.each([undefined, 900000])(
  'API judge applies and records its total timeout %s',
  async (timeout) => {
    const gold = read('gold/canvas-001.json');
    const row = {
      vars: { image: 'images/canvas-001.png', question: 'prompts/canvas-001.txt' },
      metadata: {
        case_id: 'canvas-001',
        image_sha256: hash(bytes('images/canvas-001.png')),
        gold_path: 'gold/canvas-001.json',
        gold_sha256: hash(bytes('gold/canvas-001.json')),
      },
    };
    const candidate = {
      model_id: 'test/model',
      output: '{}',
      answer_sha256: hash('{}'),
      gold_sha256: row.metadata.gold_sha256,
    };
    vi.mocked(chat).mockResolvedValue({
      output: JSON.stringify({
        case_id: 'canvas-001',
        checkpoints: semanticCheckpoints(gold).map((point) => ({
          id: point.id,
          credit: 0,
          reason: 'test',
        })),
        extra_edits: [],
      }),
    });
    const result = await judgeCandidate(row, candidate, {
      model: 'test/judge',
      timeout_ms: timeout,
    });
    assert.equal(vi.mocked(chat).mock.calls[0][0].timeoutMs, timeout ?? 600000);
    assert.equal(result.provenance.timeout_ms, timeout ?? 600000);
  },
);
