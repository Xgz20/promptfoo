import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('tsx/esm/api', () => ({ tsImport: async () => ({ fetchWithProxy: fetchMock }) }));
beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

test('vision transport configures the shared response header timeout to 600 seconds', async () => {
  vi.stubEnv('REQUEST_TIMEOUT_MS', undefined);
  fetchMock.mockImplementation(async () => {
    assert.equal(process.env.REQUEST_TIMEOUT_MS, '600000');
    return new Response('{}');
  });
  const { fetchForVision } = await import('../../scripts/astudio/vision/network.mjs');
  assert.equal((await fetchForVision('https://example.com')).status, 200);
});

test('an explicitly configured transport timeout is preserved', async () => {
  vi.stubEnv('REQUEST_TIMEOUT_MS', '900000');
  fetchMock.mockImplementation(async () => {
    assert.equal(process.env.REQUEST_TIMEOUT_MS, '900000');
    return new Response('{}');
  });
  const { fetchForVision } = await import('../../scripts/astudio/vision/network.mjs');
  await fetchForVision('https://example.com');
});
