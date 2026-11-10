let proxyFetch;

// The surrounding runner is JavaScript. tsImport loads the repository's shared
// TypeScript transport lazily, so offline report generation stays independent.
export async function fetchForVision(url, options) {
  if (!proxyFetch) {
    Object.assign(process.env, {
      PROMPTFOO_INSECURE_SSL: process.env.PROMPTFOO_INSECURE_SSL ?? 'false',
      REQUEST_TIMEOUT_MS: process.env.REQUEST_TIMEOUT_MS ?? '600000',
    });
    proxyFetch = import('tsx/esm/api')
      .then(({ tsImport }) => tsImport('../../../src/util/fetch/index.ts', import.meta.url))
      .then(({ fetchWithProxy }) => fetchWithProxy);
  }
  return (await proxyFetch)(url, options);
}
