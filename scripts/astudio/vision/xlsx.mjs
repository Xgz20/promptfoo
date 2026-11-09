import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { priceRows } from './pricing.mjs';

const names = ['整体对比', '场景对比', '能力对比', '模型单价'];
const quote = (text) => `"${String(text).replaceAll('"', '""')}"`;
const valueOr = (value, missing = 'N/A') =>
  typeof value === 'number' && Number.isFinite(value) ? value : missing;

async function artifactTool() {
  const runtime =
    process.env.ASTUDIO_ARTIFACT_RUNTIME ??
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node');
  const require = createRequire(path.join(runtime, 'astudio-loader.cjs'));
  let entry;
  try {
    entry = require.resolve('@oai/artifact-tool');
  } catch {
    throw new Error(
      'Excel 导出需要 Artifact Tool 运行时。请设置 ASTUDIO_ARTIFACT_RUNTIME 为含 node_modules 的运行时目录，见报告指南。',
    );
  }
  return import(pathToFileURL(entry).href);
}

function baseSheet(workbook, name, title, context) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.tabColor = name === '模型单价' ? '#64748B' : '#203B63';
  sheet.getRange('B2').values = [[title]];
  sheet.getRange('B2:J2').format.font = { name: 'Arial', size: 14, bold: true, color: '#17304F' };
  sheet.getRange('B3:J3').format.borders = { bottom: { style: 'thin', color: '#C5D1E0' } };
  sheet.getRange('B4').values = [[context]];
  sheet.getRange('B4:J4').format.font = { name: 'Arial', size: 10, color: '#64748B' };
  sheet.freezePanes.freezeRows(6);
  sheet.freezePanes.freezeColumns(2);
  return sheet;
}

function table(sheet, row, headers, data, tableName, widths) {
  const count = Math.max(data.length, 1);
  const range = sheet.getRangeByIndexes(row - 1, 1, count + 1, headers.length);
  range.values = [headers, ...data];
  range.format.font = { name: 'Arial', size: 10, color: '#24364D' };
  range.format.verticalAlignment = 'center';
  range.format.rowHeight = 22;
  range.format.horizontalAlignment = 'right';
  const heading = sheet.getRangeByIndexes(row - 1, 1, 1, headers.length);
  heading.format = {
    fill: '#203B63',
    font: { name: 'Arial', size: 10, color: '#FFFFFF', bold: true },
    wrapText: true,
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    rowHeight: 32,
  };
  headers.forEach((_header, index) => {
    sheet.getRangeByIndexes(row - 1, index + 1, count + 1, 1).format.columnWidth =
      widths[index] ?? 16;
  });
  if (data.length) {
    sheet.tables.add(
      `B${row}:${String.fromCharCode(65 + headers.length)}${row + count}`,
      true,
      tableName,
    );
  }
  return range;
}

function averageFormula(values, criteria, expected) {
  const tests = criteria.flatMap(([range, value]) => [range, quote(value)]).join(',');
  return `=IF(COUNTIFS(${tests},${values},">=0")=${expected},SUMIFS(${values},${tests})/${expected},"N/A")`;
}

export async function createReportWorkbook(report) {
  const { Workbook, SpreadsheetFile } = await artifactTool();
  const workbook = Workbook.create();
  const context = `${report.scope === 'full' ? '全量评测' : '接口验证样本'}。每模型 ${report.selected_cases}/${report.dataset_size} 题。成本按公开实时单价估算，裁判费用单列。`;
  const sheets = names.map((name) => baseSheet(workbook, name, `视觉模型评测 ${name}`, context));
  const [overall, scenes, capabilities, pricingSheet] = sheets;
  const prices = priceRows(report.pricing).filter((row) => row.billing_mode === 'on_demand');
  assert.ok(prices.length);
  const priceFirst = 7,
    priceLast = priceFirst + prices.length - 1;
  pricingSheet.getRange('B4').values = [
    [`单位为人民币元 / 百万 token。价格截至 ${report.sources.pricing_as_of}。`],
  ];
  pricingSheet.getRange('B5').values = [
    [`模型名单来源 ${report.sources.models}。价格来源 https://venus.xunfei.cn/pricing。`],
  ];
  pricingSheet.getRange('B5:O5').format.font = { name: 'Arial', size: 9, color: '#64748B' };
  table(
    pricingSheet,
    6,
    [
      '模型',
      '调用 ID',
      '计价渠道',
      '输入上下文档位',
      '时段（北京时间）',
      '输入 / 1M',
      '输出 / 1M',
      '缓存读 / 1M',
      '缓存写 / 1M',
      '币种',
      '价格日期',
      '计费条件',
      '价格来源',
      '计价标识',
    ],
    prices.map((row) => [
      row.model_name,
      row.model_id,
      row.provider_name,
      row.tier,
      row.rate_label +
        (row.windows.length
          ? ` ${row.windows.map((window) => `${window.start}–${window.end}`).join('、')}`
          : row.rate_key === 'static'
            ? ''
            : '（其余时段）'),
      valueOr(row.input, '未公布'),
      valueOr(row.output, '未公布'),
      valueOr(row.cache_read, '未公布'),
      valueOr(row.cache_write, '未公布'),
      row.currency,
      new Date(row.as_of),
      `${row.region}，实时按量${row.cache_write_ttl ? `，缓存写TTL ${row.cache_write_ttl}` : ''}`,
      'https://venus.xunfei.cn/pricing',
      row.key,
    ]),
    'VisionPrices',
    [27, 40, 27, 19, 28, 15, 15, 16, 16, 9, 17, 29, 38, 42],
  );
  pricingSheet.getRange(`B7:F${priceLast}`).format.horizontalAlignment = 'left';
  pricingSheet.getRange(`M7:O${priceLast}`).format.horizontalAlignment = 'left';
  pricingSheet.getRange(`G7:J${priceLast}`).setNumberFormat('0.00####');
  pricingSheet.getRange(`L7:L${priceLast}`).setNumberFormat('yyyy-mm-dd');
  const priceKeys = `'模型单价'!$O$${priceFirst}:$O$${priceLast}`;

  const detailHeader = Math.max(12, report.overall.length + 9);
  const detailFirst = detailHeader + 1,
    detailLast = detailHeader + report.records.length;
  const detailRanges = Object.fromEntries(
    [
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
      'M',
      'N',
      'O',
      'P',
      'Q',
      'R',
      'S',
      'T',
    ].map((column) => [column, `'整体对比'!$${column}$${detailFirst}:$${column}$${detailLast}`]),
  );
  table(
    overall,
    detailHeader,
    [
      '模型调用 ID',
      '用例 ID',
      '场景标识',
      '单题最终分',
      '耗时（秒）',
      '总 token',
      '输入 token',
      '输出 token',
      '缓存读 token',
      '缓存写 token',
      '非缓存输入 token',
      '计价标识',
      '成本估算（元）',
      '输入单价 / 1M',
      '输出单价 / 1M',
      '缓存读价 / 1M',
      '缓存写价 / 1M',
      '调用状态',
      '判分状态',
    ],
    report.records.map((record) => {
      const usage = record.cost?.usage;
      const ordinary =
        usage?.input == null || usage.cache_read == null || usage.cache_write == null
          ? null
          : usage.input - usage.cache_read - usage.cache_write;
      return [
        record.model_id,
        record.case_id,
        record.scene,
        valueOr(record.result?.score, '待评分'),
        valueOr(record.candidate?.elapsed_ms == null ? null : record.candidate.elapsed_ms / 1000),
        valueOr(usage?.total),
        valueOr(usage?.input),
        valueOr(usage?.output),
        valueOr(usage?.cache_read),
        valueOr(usage?.cache_write),
        valueOr(ordinary),
        record.cost?.price_key ?? '',
        valueOr(record.cost?.amount, '缺少计价数据'),
        '',
        '',
        '',
        '',
        record.candidate?.status ?? '待调用',
        record.result
          ? '已评分'
          : record.candidate?.status === 'invalid_configuration'
            ? '调用配置异常'
            : record.review_error
              ? '裁判异常'
              : '待裁判',
      ];
    }),
    'VisionTaskDetails',
    [31, 20, 18, 16, 16, 16, 16, 16, 17, 17, 20, 42, 20, 20, 20, 20, 20, 15, 15],
  );
  overall.getRange(`B${detailFirst}:D${detailLast}`).format.horizontalAlignment = 'left';
  overall.getRange(`E${detailFirst}:E${detailLast}`).setNumberFormat('0.00');
  overall.getRange(`F${detailFirst}:F${detailLast}`).setNumberFormat('0.00');
  overall.getRange(`N${detailFirst}:N${detailLast}`).setNumberFormat('0.000000');
  report.records.forEach((record, index) => {
    const row = detailFirst + index;
    if (record.cost?.amount === null || !record.cost) {
      return;
    }
    ['G', 'H', 'I', 'J'].forEach((source, index) => {
      overall.getCell(row - 1, 14 + index).formulas = [
        [
          `=INDEX('模型单价'!$${source}$${priceFirst}:$${source}$${priceLast},MATCH($M${row},${priceKeys},0))`,
        ],
      ];
    });
    overall.getRange(`N${row}`).formulas = [
      [
        `=(L${row}*O${row}+I${row}*P${row}+IF(J${row}=0,0,J${row}*Q${row})+IF(K${row}=0,0,K${row}*R${row}))/1000000`,
      ],
    ];
  });
  table(
    overall,
    6,
    [
      '模型',
      '总平均分',
      '单任务平均耗时（秒）',
      '单任务平均总 token',
      '单任务平均输入 token',
      '单任务平均输出 token',
      '单任务平均成本（元，估算）',
      '已评 / 计划',
      '调用失败数',
    ],
    report.overall.map((model) => [
      model.name,
      valueOr(model.score),
      valueOr(model.latency_seconds),
      valueOr(model.total_tokens),
      valueOr(model.input_tokens),
      valueOr(model.output_tokens),
      valueOr(model.estimated_cost),
      `${model.graded}/${model.planned}`,
      model.failed_calls,
    ]),
    'VisionOverview',
    [30, 16, 20, 21, 22, 22, 25, 16, 16],
  );
  report.overall.forEach((model, index) => {
    const row = 7 + index;
    ['E', 'F', 'G', 'H', 'I', 'N'].forEach((source, metricIndex) => {
      overall.getCell(row - 1, 2 + metricIndex).formulas = [
        [averageFormula(detailRanges[source], [[detailRanges.B, model.model_id]], model.planned)],
      ];
    });
  });
  overall.getRange(`B7:B${6 + report.overall.length}`).format.horizontalAlignment = 'left';
  overall.getRange(`C7:D${6 + report.overall.length}`).setNumberFormat('0.00');
  overall.getRange(`E7:G${6 + report.overall.length}`).setNumberFormat('0.0');
  overall.getRange(`H7:H${6 + report.overall.length}`).setNumberFormat('0.000000');

  table(
    scenes,
    6,
    [
      '场景',
      '模型',
      '题数',
      '场景平均分',
      '平均耗时（秒）',
      '平均总 token',
      '平均输入 token',
      '平均输出 token',
      '平均成本（元，估算）',
      '已评 / 计划',
    ],
    report.scenes.map((scene) => [
      scene.scene_name,
      scene.name,
      scene.planned,
      valueOr(scene.score),
      valueOr(scene.latency_seconds),
      valueOr(scene.total_tokens),
      valueOr(scene.input_tokens),
      valueOr(scene.output_tokens),
      valueOr(scene.estimated_cost),
      `${scene.graded}/${scene.planned}`,
    ]),
    'VisionScenes',
    [24, 29, 10, 18, 19, 19, 19, 19, 25, 17],
  );
  report.scenes.forEach((scene, index) => {
    const row = 7 + index;
    if (!scene.planned) {
      return;
    }
    ['E', 'F', 'G', 'H', 'I', 'N'].forEach((source, metricIndex) => {
      scenes.getCell(row - 1, 4 + metricIndex).formulas = [
        [
          averageFormula(
            detailRanges[source],
            [
              [detailRanges.B, scene.model_id],
              [detailRanges.D, scene.scene_id],
            ],
            scene.planned,
          ),
        ],
      ];
    });
  });
  scenes.getRange(`B7:C${6 + report.scenes.length}`).format.horizontalAlignment = 'left';
  scenes.getRange(`E7:F${6 + report.scenes.length}`).setNumberFormat('0.00');
  scenes.getRange(`G7:I${6 + report.scenes.length}`).setNumberFormat('0.0');
  scenes.getRange(`J7:J${6 + report.scenes.length}`).setNumberFormat('0.000000');

  const capabilityDetail = report.records.flatMap((record) => {
    const points = Object.entries(record.applicable_points)
      .filter(([, possible]) => possible > 0)
      .map(([dimension, possible]) => [
        record.model_id,
        record.case_id,
        dimension,
        valueOr(record.result?.dimensions[dimension]?.earned, '待评分'),
        possible,
        record.result ? 1 : 0,
      ]);
    if (record.annotation_count) {
      points.push([
        record.model_id,
        record.case_id,
        '批注完整正确率',
        valueOr(record.result?.annotation_complete_count, '待评分'),
        record.annotation_count,
        record.result ? 1 : 0,
      ]);
    }
    return points;
  });
  const capHeader = Math.max(28, report.capabilities.length + 12);
  const capFirst = capHeader + 1,
    capLast = capHeader + capabilityDetail.length;
  table(
    capabilities,
    capHeader,
    ['模型调用 ID', '用例 ID', '能力 / 批注指标', '正确数', '适用总数', '已评分标识'],
    capabilityDetail,
    'VisionCapabilityDetails',
    [33, 23, 35, 17, 18, 18],
  );
  const capRange = (column) => `$${column}$${capFirst}:$${column}$${capLast}`;
  table(
    capabilities,
    6,
    ['能力 / 批注指标', '模型', '适用题数', '正确数', '适用总数', '正确率', '统计口径'],
    report.capabilities.map((capability) => [
      capability.name,
      capability.model_name,
      capability.applicable_tasks,
      valueOr(capability.earned, '待评分'),
      capability.possible,
      valueOr(capability.rate),
      capability.aggregation,
    ]),
    'VisionCapabilities',
    [34, 29, 15, 17, 17, 17, 36],
  );
  report.capabilities.forEach((capability, index) => {
    const row = 7 + index;
    const conditions = `${capRange('B')},${quote(capability.model_id)},${capRange('D')},${quote(capability.name)}`;
    capabilities.getRange(`E${row}`).formulas = [
      [
        `=IF(COUNTIFS(${conditions},${capRange('G')},0)>0,"待评分",SUMIFS(${capRange('E')},${conditions}))`,
      ],
    ];
    capabilities.getRange(`F${row}`).formulas = [[`=SUMIFS(${capRange('F')},${conditions})`]];
    capabilities.getRange(`G${row}`).formulas = [
      [`=IF(F${row}=0,"N/A",IF(ISNUMBER(E${row}),E${row}/F${row},"待评分"))`],
    ];
  });
  capabilities.getRange(`B7:C${6 + report.capabilities.length}`).format.horizontalAlignment =
    'left';
  capabilities.getRange(`H7:H${6 + report.capabilities.length}`).format.horizontalAlignment =
    'left';
  capabilities.getRange(`G7:G${6 + report.capabilities.length}`).setNumberFormat('0.00%');
  workbook.recalculate();
  return { workbook, SpreadsheetFile, sheets, priceFirst, priceLast, detailFirst, detailLast };
}

export async function exportReport(report, output, previewDir) {
  const { workbook, SpreadsheetFile, sheets } = await createReportWorkbook(report);
  const check = (actual, expected, label) => {
    if (expected === null) {
      assert.equal(typeof actual, 'string', `缺失指标应显式显示 ${label}`);
    } else {
      assert.ok(
        typeof actual === 'number' && Math.abs(actual - expected) < 1e-8,
        `Excel 与独立汇总不一致 ${label}，实际 ${actual}，期望 ${expected}`,
      );
    }
  };
  const actual = workbook.worksheets.getItem('整体对比');
  for (let index = 0; index < report.overall.length; index++) {
    const expected = report.overall[index];
    const cells = actual.getRange(`C${7 + index}:H${7 + index}`).values[0];
    const values = [
      expected.score,
      expected.latency_seconds,
      expected.total_tokens,
      expected.input_tokens,
      expected.output_tokens,
      expected.estimated_cost,
    ];
    values.forEach((value, column) =>
      check(cells[column], value, `${expected.name} 整体列 ${column}`),
    );
  }
  const sceneSheet = workbook.worksheets.getItem('场景对比');
  for (let index = 0; index < report.scenes.length; index++) {
    const expected = report.scenes[index];
    const cells = sceneSheet.getRange(`E${7 + index}:J${7 + index}`).values[0];
    const values = [
      expected.score,
      expected.latency_seconds,
      expected.total_tokens,
      expected.input_tokens,
      expected.output_tokens,
      expected.estimated_cost,
    ];
    values.forEach((value, column) =>
      check(cells[column], value, `${expected.name} ${expected.scene_name} 列 ${column}`),
    );
  }
  const capabilitySheet = workbook.worksheets.getItem('能力对比');
  for (let index = 0; index < report.capabilities.length; index++) {
    const expected = report.capabilities[index];
    const cells = capabilitySheet.getRange(`E${7 + index}:G${7 + index}`).values[0];
    [expected.earned, expected.possible, expected.rate].forEach((value, column) =>
      check(cells[column], value, `${expected.model_name} ${expected.name} 列 ${column}`),
    );
  }
  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',
    options: { useRegex: true, maxResults: 20 },
    maxChars: 2500,
  });
  for (const sheet of sheets) {
    const values = sheet.getUsedRange().values;
    for (const row of values) {
      for (const cell of row) {
        assert.ok(
          typeof cell !== 'string' ||
            !/^#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/.test(cell),
          `Excel 公式错误 ${sheet.name} ${cell}`,
        );
      }
    }
  }
  if (previewDir) {
    await fs.mkdir(previewDir, { recursive: true });
    for (const sheet of sheets) {
      const preview = await workbook.render({
        sheetName: sheet.name,
        range:
          sheet.name === '能力对比' ? 'B1:H22' : sheet.name === '模型单价' ? 'B1:M26' : 'B1:K20',
        scale: 1.5,
        format: 'png',
      });
      await fs.writeFile(
        path.join(previewDir, `${sheet.name}.png`),
        new Uint8Array(await preview.arrayBuffer()),
      );
    }
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(output);
  return { sheets: names, output, formula_scan: errors.ndjson };
}
