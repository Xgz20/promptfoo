import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export function reportTimestamp(generatedAt) {
  const date = new Date(generatedAt);
  assert.ok(Number.isFinite(date.getTime()), '报告生成时间无效');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

export function timestampedReportPath({ runRoot, runId, requestedPath, generatedAt }) {
  const requested = path.resolve(
    requestedPath ?? path.join(runRoot, 'outputs', runId, '视觉模型评测报告.xlsx'),
  );
  const parsed = path.parse(requested);
  const stem = parsed.ext.toLowerCase() === '.xlsx' ? parsed.name : parsed.base;
  return path.join(parsed.dir, `${stem}_${reportTimestamp(generatedAt)}.xlsx`);
}

export function publishReport(source, requested) {
  const { dir, name, ext } = path.parse(requested);
  let suffix = 1;
  while (true) {
    const output = suffix === 1 ? requested : path.join(dir, `${name}_${suffix}${ext}`);
    try {
      fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL);
      return output;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      suffix++;
    }
  }
}
