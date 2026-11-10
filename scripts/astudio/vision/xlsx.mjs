import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { priceRows } from './pricing.mjs';
import { DIMENSIONS } from './score.mjs';
import {
  CALCULATION_FIELDS,
  caseColumnPlan,
  compactLines,
  excelColumn,
  hideColumnDefinitions,
  sortModelsByScore,
} from './workbook-layout.mjs';

const names = ['整体对比', '场景对比', '能力对比', '用例明细', '模型单价'];
const valueOr = (value, missing = 'N/A') =>
  typeof value === 'number' && Number.isFinite(value) ? value : missing;
const quote = (text) => `"${String(text).replaceAll('"', '""')}"`;

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
      'Excel 导出需要 Artifact Tool 运行时。请设置 ASTUDIO_ARTIFACT_RUNTIME，见报告指南。',
    );
  }
  const module = await import(pathToFileURL(entry).href);
  const { default: JSZip } = await import(pathToFileURL(require.resolve('jszip')).href);
  return { ...module, JSZip };
}

function baseSheet(workbook, name, context) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.tabColor = name === '模型单价' ? '#64748B' : '#203B63';
  sheet.getRange('B2').values = [[`视觉模型评测 ${name}`]];
  sheet.getRange('B2:J2').format.font = { name: 'Arial', size: 14, bold: true, color: '#17304F' };
  sheet.getRange('B3:J3').format.borders = { bottom: { style: 'thin', color: '#C5D1E0' } };
  sheet.getRange('B4').values = [[context]];
  sheet.getRange('B4:J5').format.font = { name: 'Arial', size: 10, color: '#64748B' };
  sheet.freezePanes.freezeRows(6);
  sheet.freezePanes.freezeColumns(name === '用例明细' ? 3 : 2);
  return sheet;
}

function table(sheet, headers, data, name, widths) {
  assert.ok(data.length, `工作表数据为空 ${sheet.name}`);
  const last = 6 + data.length;
  const range = sheet.getRangeByIndexes(5, 1, data.length + 1, headers.length);
  range.values = [headers, ...data];
  range.format.font = { name: 'Arial', size: 10, color: '#24364D' };
  range.format.verticalAlignment = 'center';
  range.format.horizontalAlignment = 'right';
  range.format.rowHeight = 22;
  const heading = sheet.getRangeByIndexes(5, 1, 1, headers.length);
  heading.format = {
    fill: '#203B63',
    font: { name: 'Arial', size: 10, color: '#FFFFFF', bold: true },
    wrapText: true,
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    rowHeight: 36,
  };
  headers.forEach((_header, index) => {
    sheet.getRangeByIndexes(5, index + 1, data.length + 1, 1).format.columnWidth =
      widths[index] ?? 16;
  });
  sheet.tables.add(`B6:${excelColumn(headers.length)}${last}`, true, name);
  return last;
}

function scoreGradient(sheet, range, maximum) {
  const cells = sheet.getRange(range);
  cells.conditionalFormats.add('colorScale', {
    colors: ['#F4CDC7', '#FFF0BF', '#C8E7D6'],
    thresholds: [
      { type: 'num', value: 0 },
      { type: 'num', value: maximum / 2 },
      { type: 'num', value: maximum },
    ],
  });
  cells.conditionalFormats.add('containsText', {
    text: 'N/A',
    format: { fill: '#EEF2F6', font: { color: '#64748B' } },
  });
}

function meanFormula(range, count, sceneRange, scene) {
  if (!count) {
    return null;
  }
  if (!sceneRange) {
    return `=IF(COUNTIFS(${range},">=0")=${count},SUM(${range})/${count},"N/A")`;
  }
  return `=IF(COUNTIFS(${sceneRange},${quote(scene)},${range},">=0")=${count},SUMIFS(${range},${sceneRange},${quote(scene)})/${count},"N/A")`;
}

function writePrices(sheet, report) {
  const rows = priceRows(report.pricing).filter((row) => row.billing_mode === 'on_demand');
  assert.ok(rows.length);
  sheet.getRange('B4').values = [
    [`单位为人民币元 / 百万 token。价格截至 ${report.sources.pricing_as_of}。`],
  ];
  sheet.getRange('B5').values = [
    [`模型名单来源 ${report.sources.models}。价格来源 https://venus.xunfei.cn/pricing。`],
  ];
  sheet.getRange('B5:O5').format.font = { name: 'Arial', size: 9, color: '#64748B' };
  const last = table(
    sheet,
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
    rows.map((row) => [
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
  sheet.getRange(`B7:F${last}`).format.horizontalAlignment = 'left';
  sheet.getRange('B6:O6').format.rowHeight = 32;
  sheet.getRange(`M7:O${last}`).format.horizontalAlignment = 'left';
  sheet.getRange(`G7:J${last}`).setNumberFormat('0.00####');
  sheet.getRange(`L7:L${last}`).setNumberFormat('yyyy-mm-dd');
  return { first: 7, last };
}

function numericInputs(record) {
  const usage = record.cost?.usage;
  const values = {
    earned: valueOr(record.result?.earned_points, '待评分'),
    possible: record.checkpoints.length,
    penalty: valueOr(record.result?.extra_edit_penalty, '待评分'),
    latency: valueOr(
      record.candidate?.elapsed_ms == null ? null : record.candidate.elapsed_ms / 1000,
    ),
    total_tokens: valueOr(usage?.total),
    input_tokens: valueOr(usage?.input),
    output_tokens: valueOr(usage?.output),
    cache_read: valueOr(usage?.cache_read),
    cache_write: valueOr(usage?.cache_write),
    ordinary_input: valueOr(
      usage?.input == null || usage.cache_read == null || usage.cache_write == null
        ? null
        : usage.input - usage.cache_read - usage.cache_write,
    ),
    price_key: record.cost?.price_key ?? '',
    cost: valueOr(record.cost?.amount, '缺少计价数据'),
    unit_input: '',
    unit_output: '',
    unit_cache_read: '',
    unit_cache_write: '',
    annotation_earned: record.annotation_count
      ? valueOr(record.result?.annotation_complete_count, '待评分')
      : 0,
    annotation_possible: record.annotation_count,
  };
  DIMENSIONS.forEach((dimension, index) => {
    const possible = record.applicable_points[dimension];
    values[`dimension_${index}_earned`] = possible
      ? valueOr(record.result?.dimensions[dimension]?.earned, '待评分')
      : 0;
    values[`dimension_${index}_possible`] = possible;
  });
  return values;
}

function writeCaseDetails(sheet, report, prices) {
  const cases = report.case_details;
  assert.ok(cases?.length === report.selected_cases, '请从运行目录重新生成含检查点的用例明细');
  const plan = caseColumnPlan(report.overall);
  const records = new Map(
    report.records.map((record) => [`${record.model_id}\n${record.case_id}`, record]),
  );
  const sceneNames = new Map(report.scenes.map((scene) => [scene.scene_id, scene.scene_name]));
  const headers = [
    ...plan.visibleHeaders,
    '计算辅助 场景标识',
    ...plan.modelColumns.flatMap((model) =>
      CALCULATION_FIELDS.map((field) => `${model.model_id} ${field}`),
    ),
  ];
  const rowHeights = [];
  const data = cases.map((item) => {
    assert.ok(item.checkpoints.length, `用例缺少检查点定义 ${item.case_id}`);
    const points = compactLines(
      item.checkpoints.map((point) => `${point.id} ${point.expected}`),
      100,
    );
    const values = Array(headers.length).fill('');
    values[0] = item.case_id;
    values[1] = sceneNames.get(item.scene) ?? item.scene;
    values[2] = item.name;
    values[3] = points.text;
    values[plan.sceneColumn - 1] = item.scene;
    let lineCount = points.lineCount;
    for (const columns of plan.modelColumns) {
      const model = item.models.find((model) => model.model_id === columns.model_id);
      const record = records.get(`${columns.model_id}\n${item.case_id}`);
      assert.ok(model && record);
      const detail = compactLines(
        model.checkpoints.map((point) => `${point.id}=${point.credit ?? '待评'}`),
        42,
      );
      const headline =
        model.score == null
          ? record.candidate?.status === 'invalid_configuration'
            ? '调用配置异常'
            : record.review_error
              ? '裁判异常'
              : '待评分'
          : `正确 ${model.earned_points}/${model.total_points}，扣分 ${model.extra_edit_penalty}`;
      values[columns.score - 1] = valueOr(model.score, '待评分');
      values[columns.points - 1] = `${headline}\n${detail.text}`;
      lineCount = Math.max(lineCount, detail.lineCount + 1);
      const inputs = numericInputs(record);
      for (const [field, column] of Object.entries(columns.fields)) {
        values[column - 1] = inputs[field];
      }
    }
    rowHeights.push(Math.max(48, Math.min(409.5, lineCount * 13 + 10)));
    return values;
  });
  const widths = [
    18,
    23,
    35,
    100,
    ...report.overall.flatMap(() => [21, 42]),
    18,
    ...plan.modelColumns.flatMap(() =>
      CALCULATION_FIELDS.map((field) => (field === 'price_key' ? 42 : 18)),
    ),
  ];
  const last = table(sheet, headers, data, 'VisionCaseDetails', widths);
  sheet.getRange(`B7:E${last}`).format.horizontalAlignment = 'left';
  sheet.getRange(`D7:E${last}`).format.wrapText = true;
  sheet.getRange(`B7:${excelColumn(plan.visibleLast)}${last}`).format.verticalAlignment = 'top';
  const keys = `'模型单价'!$O$${prices.first}:$O$${prices.last}`;
  const cell = (column, row) => `${excelColumn(column)}${row}`;
  cases.forEach((item, index) => {
    const row = 7 + index;
    sheet.getRangeByIndexes(row - 1, 1, 1, plan.visibleHeaders.length).format.rowHeight =
      rowHeights[index];
    for (const columns of plan.modelColumns) {
      const field = (name) => cell(columns.fields[name], row);
      sheet.getCell(row - 1, columns.score).formulas = [
        [
          `=IF(ISNUMBER(${field('earned')}),MAX(0,100*${field('earned')}/${field('possible')}-${field('penalty')}),"待评分")`,
        ],
      ];
      sheet.getCell(row - 1, columns.score).setNumberFormat('0.00');
      sheet.getCell(row - 1, columns.points).format.wrapText = true;
      sheet.getCell(row - 1, columns.points).format.horizontalAlignment = 'left';
      const record = records.get(`${columns.model_id}\n${item.case_id}`);
      if (record.cost?.amount == null) {
        continue;
      }
      ['unit_input', 'unit_output', 'unit_cache_read', 'unit_cache_write'].forEach(
        (name, index) => {
          const source = ['G', 'H', 'I', 'J'][index];
          sheet.getCell(row - 1, columns.fields[name]).formulas = [
            [
              `=INDEX('模型单价'!$${source}$${prices.first}:$${source}$${prices.last},MATCH(${field('price_key')},${keys},0))`,
            ],
          ];
        },
      );
      const products = [
        ['ordinary_input', 'unit_input'],
        ['output_tokens', 'unit_output'],
        ['cache_read', 'unit_cache_read'],
        ['cache_write', 'unit_cache_write'],
      ].map(([quantity, price]) => `IF(${field(quantity)}=0,0,${field(quantity)}*${field(price)})`);
      sheet.getCell(row - 1, columns.fields.cost).formulas = [[`=(${products.join('+')})/1000000`]];
    }
  });
  return { ...plan, firstRow: 7, lastRow: last, rowHeights };
}

export async function createReportWorkbook(report) {
  const { Workbook, SpreadsheetFile, JSZip } = await artifactTool();
  const workbook = Workbook.create();
  const comparisonModels = sortModelsByScore(report.overall);
  const scope = `${report.scope === 'full' ? '全量评测' : '接口验证样本'}。每模型 ${report.selected_cases}/${report.dataset_size} 题。`;
  const context = {
    整体对比: `${scope}成本按当前候选请求的公开单价估算，补跑历史与裁判用量另存。`,
    场景对比: `${scope}各场景按该场景内题目得分平均，表头题数为本轮计划题数。`,
    能力对比: `${scope}能力按检查点汇总正确率，批注按完整正确批注数计算。`,
    用例明细: `${scope}每题百分制，检查点0/1。基础分为正确数/总数×100，再扣除额外修改分，最低0分。`,
    模型单价: '',
  };
  const sheets = names.map((name) => baseSheet(workbook, name, context[name]));
  const [overall, scenes, capabilities, details, pricingSheet] = sheets;
  const prices = writePrices(pricingSheet, report);
  const plan = writeCaseDetails(details, report, prices);
  const range = (column) =>
    `'用例明细'!$${excelColumn(column)}$${plan.firstRow}:$${excelColumn(column)}$${plan.lastRow}`;
  const columnsByModel = new Map(plan.modelColumns.map((columns) => [columns.model_id, columns]));
  const overallLast = table(
    overall,
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
    comparisonModels.map((model) => [
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
  comparisonModels.forEach((model, index) => {
    const columns = columnsByModel.get(model.model_id);
    [
      columns.score,
      ...['latency', 'total_tokens', 'input_tokens', 'output_tokens', 'cost'].map(
        (field) => columns.fields[field],
      ),
    ].forEach((source, metric) => {
      overall.getCell(6 + index, 2 + metric).formulas = [
        [meanFormula(range(source), model.planned)],
      ];
    });
  });
  overall.getRange(`B7:B${overallLast}`).format.horizontalAlignment = 'left';
  overall.getRange('B6:J6').format.rowHeight = 32;
  overall.getRange(`C7:D${overallLast}`).setNumberFormat('0.00');
  overall.getRange(`E7:G${overallLast}`).setNumberFormat('0.0');
  overall.getRange(`H7:H${overallLast}`).setNumberFormat('0.000000');
  if (report.execution?.per_model_concurrency && report.execution.max_tokens) {
    const execution = report.execution;
    const failures = report.overall.reduce((sum, model) => sum + model.failed_calls, 0);
    const retries = report.records.filter((record) => record.candidate?.retry).length;
    overall.getRange('B5').values = [
      [
        `候选模型并发${execution.model_concurrency}，单模型并发${execution.per_model_concurrency}，默认请求参数max_tokens=${execution.max_tokens}。候选失败${failures}题按0分计，缺少完整用量的成本为N/A。${retries ? `补跑${retries}题采用入选响应。` : ''}`,
      ],
    ];
  }

  const categories = [
    ...new Map(
      report.scenes.map((scene) => [
        scene.scene_id,
        { id: scene.scene_id, name: scene.scene_name, count: scene.planned },
      ]),
    ).values(),
  ];
  const sceneLast = table(
    scenes,
    ['模型', '总平均分', ...categories.map((scene) => `${scene.name}\n（${scene.count}题）`)],
    comparisonModels.map((model) => [
      model.name,
      valueOr(model.score),
      ...categories.map((scene) =>
        valueOr(
          report.scenes.find(
            (item) => item.model_id === model.model_id && item.scene_id === scene.id,
          )?.score,
        ),
      ),
    ]),
    'VisionSceneMatrix',
    [30, 16, ...categories.map(() => 24)],
  );
  comparisonModels.forEach((model, index) => {
    const columns = columnsByModel.get(model.model_id);
    scenes.getCell(6 + index, 2).formulas = [[`='整体对比'!C${7 + index}`]];
    categories.forEach((scene, category) => {
      const formula = meanFormula(
        range(columns.score),
        scene.count,
        range(plan.sceneColumn),
        scene.id,
      );
      if (formula) {
        scenes.getCell(6 + index, 3 + category).formulas = [[formula]];
      }
    });
  });
  scenes.getRange(`B7:B${sceneLast}`).format.horizontalAlignment = 'left';
  scenes.getRange(`C7:${excelColumn(categories.length + 2)}${sceneLast}`).setNumberFormat('0.00');
  scenes.getRange('B5').values = [
    ['分数范围0～100。红色低分，绿色高分，N/A为尚未完成或无适用题。'],
  ];
  scoreGradient(scenes, `C7:${excelColumn(categories.length + 2)}${sceneLast}`, 100);

  const dimensions = [...DIMENSIONS, '批注完整正确率'];
  const capabilityLast = table(
    capabilities,
    ['模型', '总平均分', ...dimensions],
    comparisonModels.map((model) => [
      model.name,
      valueOr(model.score),
      ...dimensions.map((dimension) =>
        valueOr(
          report.capabilities.find(
            (item) => item.model_id === model.model_id && item.name === dimension,
          )?.rate,
        ),
      ),
    ]),
    'VisionCapabilityMatrix',
    [30, 16, ...dimensions.map(() => 25)],
  );
  comparisonModels.forEach((model, index) => {
    const columns = columnsByModel.get(model.model_id);
    capabilities.getCell(6 + index, 2).formulas = [[`='整体对比'!C${7 + index}`]];
    dimensions.forEach((_dimension, category) => {
      const prefix = category < DIMENSIONS.length ? `dimension_${category}` : 'annotation';
      const earned = range(columns.fields[`${prefix}_earned`]);
      const possible = range(columns.fields[`${prefix}_possible`]);
      capabilities.getCell(6 + index, 3 + category).formulas = [
        [
          `=IF(SUM(${possible})=0,"N/A",IF(COUNTIFS(${earned},">=0")=${report.selected_cases},SUM(${earned})/SUM(${possible}),"N/A"))`,
        ],
      ];
    });
  });
  capabilities.getRange(`B7:B${capabilityLast}`).format.horizontalAlignment = 'left';
  capabilities.getRange(`C7:C${capabilityLast}`).setNumberFormat('0.00');
  capabilities.getRange(`D7:J${capabilityLast}`).setNumberFormat('0.00%');
  capabilities.getRange('B5').values = [
    ['总平均分为百分制，能力为正确率。红色低分，绿色高分，N/A保留为灰色。'],
  ];
  scoreGradient(capabilities, `C7:C${capabilityLast}`, 100);
  scoreGradient(capabilities, `D7:J${capabilityLast}`, 1);
  workbook.recalculate();
  return {
    workbook,
    SpreadsheetFile,
    JSZip,
    sheets,
    casePlan: plan,
    prices,
    sceneCategories: categories,
    comparisonModels,
  };
}

export async function exportReport(report, output, previewDir) {
  const state = await createReportWorkbook(report);
  const { workbook, SpreadsheetFile, JSZip, sheets, casePlan, sceneCategories, comparisonModels } =
    state;
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
  comparisonModels.forEach((model, index) => {
    sheets.slice(0, 3).forEach((sheet) => {
      assert.equal(
        sheet.getRange(`B${7 + index}`).values[0][0],
        model.name,
        '对比表模型顺序不一致',
      );
      check(
        sheet.getRange(`C${7 + index}`).values[0][0],
        model.score,
        `${model.name} ${sheet.name} 总平均分`,
      );
    });
    const cells = sheets[0].getRange(`C${7 + index}:H${7 + index}`).values[0];
    [
      model.score,
      model.latency_seconds,
      model.total_tokens,
      model.input_tokens,
      model.output_tokens,
      model.estimated_cost,
    ].forEach((expected, column) =>
      check(cells[column], expected, `${model.name} 整体列 ${column}`),
    );
    sceneCategories.forEach((scene, category) => {
      const expected = report.scenes.find(
        (item) => item.model_id === model.model_id && item.scene_id === scene.id,
      );
      check(
        sheets[1].getCell(6 + index, 3 + category).values[0][0],
        expected.score,
        `${model.name} ${scene.name}`,
      );
    });
    [...DIMENSIONS, '批注完整正确率'].forEach((dimension, category) => {
      const expected = report.capabilities.find(
        (item) => item.model_id === model.model_id && item.name === dimension,
      );
      check(
        sheets[2].getCell(6 + index, 3 + category).values[0][0],
        expected.rate,
        `${model.name} ${dimension}`,
      );
    });
  });
  report.case_details.forEach((item, index) => {
    casePlan.modelColumns.forEach((columns) => {
      const model = item.models.find((model) => model.model_id === columns.model_id);
      check(
        sheets[3].getCell(6 + index, columns.score).values[0][0],
        model.score,
        `${item.case_id} ${model.model_name}`,
      );
    });
  });
  const errors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',
    options: { useRegex: true, maxResults: 20 },
    maxChars: 2500,
  });
  for (const sheet of sheets) {
    for (const row of sheet.getUsedRange().values) {
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
      const range =
        sheet.name === '用例明细'
          ? `B1:${excelColumn(casePlan.visibleLast)}8`
          : sheet.name === '模型单价'
            ? 'B1:M26'
            : `B1:${sheet.name === '场景对比' ? 'I' : 'J'}${Math.max(10, report.overall.length + 7)}`;
      const preview = await workbook.render({
        sheetName: sheet.name,
        range,
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
  await (await SpreadsheetFile.exportXlsx(workbook)).save(output);
  // Artifact Tool has no documented column-hiding operation. Apply only the
  // native OOXML visibility attributes, preserving cell/formula/style payloads.
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  const sheetPath = 'xl/worksheets/sheet4.xml';
  const xml = await zip.file(sheetPath).async('string');
  zip.file(
    sheetPath,
    hideColumnDefinitions(xml, casePlan.auxiliaryFirst + 1, casePlan.lastColumn + 1),
  );
  await fs.writeFile(
    output,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  return { sheets: names, output, layout_version: 'case-matrix-v2', formula_scan: errors.ndjson };
}
