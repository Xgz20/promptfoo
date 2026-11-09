import assert from 'node:assert/strict';

export async function forEachConcurrent(items, concurrency, callback) {
  assert.ok(Number.isInteger(concurrency) && concurrency > 0, '并发数需为正整数');
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await callback(items[index], index);
    }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    throw new AggregateError(
      failed.map((result) => result.reason),
      '并发任务失败',
    );
  }
}
