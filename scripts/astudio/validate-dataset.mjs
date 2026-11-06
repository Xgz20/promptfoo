import { globSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

const imageExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.tiff',
]);
const commonIdFields = ['id', 'sample_id', 'vars.sample_id', 'metadata.sample_id'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getField(row, field) {
  let value = row;
  for (const key of field.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
}

function collectFileReferences(value, references) {
  if (typeof value === 'string' && value.startsWith('file://')) {
    references.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectFileReferences(item, references);
    }
  } else if (isObject(value)) {
    for (const item of Object.values(value)) {
      collectFileReferences(item, references);
    }
  }
}

function loadRules(file) {
  if (!file) {
    return {};
  }
  const rules = JSON.parse(readFileSync(file, 'utf8'));
  if (!isObject(rules)) {
    throw new Error('规则文件应为 JSON 对象');
  }
  const supportedKeys = new Set(['requiredFields', 'idField', 'allowedValues']);
  for (const key of Object.keys(rules)) {
    if (!supportedKeys.has(key)) {
      throw new Error(`未知规则配置 ${key}`);
    }
  }
  if (
    rules.requiredFields !== undefined &&
    (!Array.isArray(rules.requiredFields) || !rules.requiredFields.every(isNonEmptyString))
  ) {
    throw new Error('requiredFields 应为字段路径字符串数组');
  }
  if (rules.idField !== undefined && !isNonEmptyString(rules.idField)) {
    throw new Error('idField 应为字段路径字符串');
  }
  if (
    rules.allowedValues !== undefined &&
    (!isObject(rules.allowedValues) ||
      !Object.values(rules.allowedValues).every(
        (values) =>
          Array.isArray(values) &&
          values.every(
            (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
          ),
      ))
  ) {
    throw new Error('allowedValues 应为字段路径到可选基本值数组的映射');
  }
  return rules;
}

function validateRow(row, rules, ids) {
  if (!isObject(row)) {
    return ['每行应为一个 JSON 对象'];
  }
  const errors = [];
  if (
    row.vars !== undefined &&
    !isObject(row.vars) &&
    !Array.isArray(row.vars) &&
    typeof row.vars !== 'string'
  ) {
    errors.push('vars 应为对象或 Promptfoo 支持的变量文件引用');
  }
  if (row.metadata !== undefined && !isObject(row.metadata)) {
    errors.push('metadata 应为对象');
  }
  if (
    row.assert !== undefined &&
    (!Array.isArray(row.assert) ||
      row.assert.some((assertion) => !isObject(assertion) || !isNonEmptyString(assertion.type)))
  ) {
    errors.push('assert 应为断言对象数组，每条断言包含非空 type');
  }
  const idField =
    rules.idField ?? commonIdFields.find((field) => getField(row, field) !== undefined);
  if (idField) {
    const id = getField(row, idField);
    const validId = isNonEmptyString(id) || (typeof id === 'number' && Number.isFinite(id));
    if (validId) {
      const key = JSON.stringify(id);
      if (ids.has(key)) {
        errors.push(`用例 ID 重复 ${key}`);
      }
      ids.add(key);
    } else {
      errors.push(`${idField} 应为非空字符串或有限数值 ID`);
    }
  }
  for (const field of rules.requiredFields ?? []) {
    const value = getField(row, field);
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      errors.push(`缺少规则要求的字段 ${field}`);
    }
  }
  for (const [field, allowed] of Object.entries(rules.allowedValues ?? {})) {
    if (!allowed.includes(getField(row, field))) {
      errors.push(`${field} 应为 ${JSON.stringify(allowed)} 中的值`);
    }
  }
  return errors;
}

function parseArgs(args) {
  const options = { allowEmpty: false, dataset: undefined, rules: undefined, basePath: undefined };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--allow-empty') {
      options.allowEmpty = true;
    } else if (arg === '--rules' || arg === '--base-path') {
      const value = args[++index];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} 需要参数值`);
      }
      options[arg === '--rules' ? 'rules' : 'basePath'] = value;
    } else if (arg.startsWith('-') || options.dataset) {
      throw new Error(`未知参数 ${arg}`);
    } else {
      options.dataset = arg;
    }
  }
  if (!options.dataset) {
    throw new Error('请指定数据集目录，可用 --help 查看用法');
  }
  return options;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      '用法 node scripts/astudio/validate-dataset.mjs <数据集目录或JSONL文件> [--rules 规则.json] [--base-path 文件基准目录] [--allow-empty]',
    );
    return;
  }
  const options = parseArgs(args);
  const inputPath = realpathSync(path.resolve(options.dataset));
  const inputIsDirectory = statSync(inputPath).isDirectory();
  const datasetRoot = inputIsDirectory ? inputPath : path.dirname(inputPath);
  const basePath = path.resolve(options.basePath ?? datasetRoot);
  const rules = loadRules(options.rules);
  const casesPath = inputIsDirectory ? path.join(inputPath, 'cases.jsonl') : inputPath;
  const content = readFileSync(casesPath, 'utf8');
  const lines = content.trim() === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/);
  const ids = new Set();
  const references = new Set();
  const images = new Set();
  const errors = [];
  if (lines.length === 0 && !options.allowEmpty) {
    errors.push('用例文件为空。草稿目录检查可加 --allow-empty');
  }
  lines.forEach((line, index) => {
    try {
      const row = JSON.parse(line);
      for (const error of validateRow(row, rules, ids)) {
        errors.push(`第 ${index + 1} 行 ${error}`);
      }
      collectFileReferences(row?.vars, references);
      collectFileReferences(row?.assert, references);
    } catch (error) {
      errors.push(`第 ${index + 1} 行 JSON 解析失败 ${error.message}`);
    }
  });
  for (const reference of references) {
    try {
      // Promptfoo 文件引用支持 :函数名 后缀，检查对应源文件。
      const filename = reference.slice('file://'.length).replace(/:[\w$]+$/, '');
      const resolved = path.resolve(basePath, filename);
      let files;
      try {
        statSync(resolved);
        files = [resolved];
      } catch {
        files = globSync(resolved);
      }
      if (files.length === 0) {
        throw new Error('文件不存在或通配符未匹配到文件');
      }
      for (const file of files) {
        const fileStat = statSync(file);
        if (!fileStat.isFile()) {
          throw new Error(`引用应指向文件 ${file}`);
        }
        if (imageExtensions.has(path.extname(file).toLowerCase())) {
          if (fileStat.size === 0) {
            throw new Error(`图片为空 ${file}`);
          }
          images.add(realpathSync(file));
        }
      }
    } catch (error) {
      errors.push(`文件引用 ${reference} ${error.message}`);
    }
  }
  if (errors.length > 0) {
    console.error(`校验失败 ${casesPath}\n${errors.map((error) => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `校验通过 ${path.basename(datasetRoot)}，${lines.length} 条用例，${images.size} 张本地图片`,
  );
}

try {
  main();
} catch (error) {
  console.error(`校验失败 ${error.message}`);
  process.exitCode = 1;
}
