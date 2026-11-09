# 产品维护视觉评测用例

在 Codex 中打开本工程，按照本指南维护 `datasets/vision/astudio-v1/`。一条用例输入一张原图和完整问题，按任务需要记录参考答案、评分规则和分类标签。已有100题含多个内容与定位小问，保留原题粒度和输出要求；具体字段、六维评分及历史回放见[当前题集说明](../../datasets/vision/astudio-v1/README.md)。

## 拉取与打开工程

首次拉取时选择包含 AStudio 定制内容的开发分支。

```bash
git clone --branch feature/astudio-vision-eval \
  ssh://git@code.iflytek.com:30004/CYXH_Agent/AstronStudio-Eval/astudio-vision-eval.git
cd astudio-vision-eval
```

在 Codex 中打开 `astudio-vision-eval` 工程根目录。根目录 `AGENTS.md` 会引导 Codex 阅读数据集说明与维护约定。已有工程可在该开发分支执行 `git pull --ff-only` 获取更新。

## 目录与使用入口

```text
datasets/vision/
├── AGENTS.md
├── README.md
├── astudio-v1/                 产品评测集草稿
│   ├── README.md
│   ├── cases.jsonl
│   └── images/
└── examples-v1/                四条合成图片示例
    ├── README.md
    ├── cases.jsonl
    └── images/
```

`astudio-v1` 已纳入设计画布20题、网页应用20题，以及日常照片、海报插画漫画、统计图表、文档票据各15题，共100题。沿用 `vars.case_id` 题号与原题版本，参考答案和原子评分点位于独立的 `gold/`，评分器通过 `defaultTest` 统一接入。当前单题按适用得分点均值计分，六维保留分项展示，具体口径及版本由 `scoring-policy.json` 管理。`examples-v1` 的四条合成题继续用于学习基础格式，不计入这100题。运行日志、模型回答与报告写入工程根目录的 `.local/`。

## 直接交给 Codex 的操作说明

将图片提供给 Codex，并粘贴以下内容，替换方括号中的信息。

```text
请阅读本工程 AGENTS.md、datasets/vision/AGENTS.md 和 docs/astudio/datasets.md，
参考 examples-v1，在 datasets/vision/astudio-v1 中新增单图评测用例。

图片位置：[图片的本地位置，或本次对话中已提供的图片]
场景：[例如票据、业务报表、软件界面]
主要考察能力：[例如图表读取]
问题：[希望向被测模型提问的内容]
参考答案及依据：[答案，以及原图中对应的位置或计算依据]
输出要求：[例如只输出季度编号]
难度：[按目标集约定填写，例如 easy、medium 或 hard]

请核对原图，分配唯一 sample_id，将原图复制到 images/，
按本任务要求补充清晰的评分规则，把完整用例以一行 JSON 写入 cases.jsonl，
运行本地校验，并列出新增 ID、图片、能力标签、答案依据和校验结果。
若信息不足以确定参考答案，请先列出需要我确认的信息。
```

产品复核时重点看原图是否可读、问题是否有明确答案，以及评分规则能否区分正确与错误回答。同一图片可以设计多个问题，各自使用独立用例 ID。

## JSONL 示例字段

`cases.jsonl` 使用 UTF-8，每行一个完整 JSON 对象。Codex 可以在编辑时用 `JSON.stringify` 序列化对象并追加换行，保持一条用例占一行。

下表为新建数据集的推荐写法。已有数据集可使用自己的变量名、参考答案类型、分组维度和断言。被测模型与裁判模板需要与这些字段匹配。

| 字段                       | 示例中的约定                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `description`              | 可读的中文用例名称                                                                                                      |
| `vars.sample_id`           | 稳定、唯一的 ID，例如 `vision_chart_0001`，也可采用数据集自己的 ID 字段                                                 |
| `vars.image`               | 一张本地图片的引用，例如 `file://images/vision_chart_0001.png`                                                          |
| `vars.question`            | 发给被测模型的问题，包含必要的输出格式要求                                                                              |
| `vars.reference`           | 示例使用字符串，实际类型由评测模板确定，可采用数字、数组或结构化答案                                                    |
| `assert`                   | 示例使用 `llm-rubric`，实际可选择 `equals`、`contains`、`javascript` 等 Promptfoo 断言，也可在 `defaultTest` 中统一配置 |
| `assert[].value`           | 按断言类型填写，裁判评分时说明评分尺度、等价答案及格式要求                                                              |
| `metadata.sample_id`       | 与 `vars.sample_id` 相同                                                                                                |
| `metadata.scene`           | 业务场景，例如 `业务报表`                                                                                               |
| `metadata.category`        | 分类标识，例如 `chart`                                                                                                  |
| `metadata.capability`      | 主要能力标识，例如 `chart_reading`                                                                                      |
| `metadata.difficulty`      | 示例使用 `easy`、`medium`、`hard`，各数据集可采用自己的分级                                                             |
| `metadata.dataset_version` | 推荐记录版本，例如 `astudio-v1`，具体格式由数据集约定                                                                   |

新建数据集推荐使用稳定的分类、能力和 `metric` 标识。业务需要的新维度可继续添加到 `metadata`，字段值可以采用中文或英文。

下面是一条可参考的 JSONL。对应图片可查看示例集中的销售柱状图。

```jsonl
{
  "description": "识别销售额最高的季度",
  "vars": {
    "sample_id": "demo_chart_0001",
    "image": "file://images/demo_chart_0001.png",
    "question": "哪一个季度的销售额最高？只输出 Q1、Q2、Q3 或 Q4。",
    "reference": "Q3"
  },
  "assert": [
    {
      "type": "llm-rubric",
      "metric": "chart_accuracy",
      "threshold": 1,
      "value": "依据原图回答且只输出Q3得1分，允许首尾空白。其它回答得0分。"
    }
  ],
  "metadata": {
    "sample_id": "demo_chart_0001",
    "scene": "业务图表",
    "category": "chart",
    "capability": "chart_reading",
    "difficulty": "easy",
    "dataset_version": "examples-v1"
  }
}
```

复制到产品集时，按实际图片与问题修改内容，并将 `metadata.dataset_version` 设置为 `astudio-v1`。

## 场景、分类、能力和评分指标

场景描述使用环境，分类用于较粗的统计，能力用于定位具体短板，`metric` 为 Promptfoo 的具名评分指标。同类用例复用已有标识，新能力确定含义后可扩展。

| 场景示例 | category     | capability         | metric             |
| -------- | ------------ | ------------------ | ------------------ |
| 票据     | `ocr`        | `text_recognition` | `ocr_accuracy`     |
| 业务报表 | `chart`      | `chart_reading`    | `chart_accuracy`   |
| 物品清点 | `perception` | `object_counting`  | `count_accuracy`   |
| 位置判断 | `perception` | `spatial_relation` | `spatial_accuracy` |

`metadata` 保存分组标签，分类与能力的汇总由报告流程按标签计算。`metric` 标识断言分数。标注难度时，以真实业务中的识别与推理要求为依据。

## 图片与路径

图片放入数据集自己的 `images/`，支持 PNG、JPG、JPEG、WebP。新图片可按首个关联用例 ID 命名。同一张图有多个问题时，可以复用同一个图片引用。

本工程约定 `vars.image` 相对数据集根目录。Promptfoo 的评测配置需要通过 `basePath` 对齐这个目录。例如配置位于 `evals/vision/promptfooconfig.yaml` 时，可使用以下接入片段。

```yaml
basePath: ../../datasets/vision/astudio-v1
tests: file://cases.jsonl
```

被测模型的输入模板使用 `vars.question` 和 `vars.image`。裁判模板使用原图、问题、参考答案、待评回答和评分规则。Promptfoo 加载本地图片后，`{{image}}` 已经是完整 data URL，图片块直接使用 `"url": "{{image}}"`。

## 本地校验与交付

本地校验只依赖 Node.js，执行前按工程 `.nvmrc` 选择版本。以下命令均从工程根目录运行。

```bash
# 学习结构时先验证已有示例
node scripts/astudio/validate-dataset.mjs datasets/vision/examples-v1

# 新增产品用例后验证正式目录
node scripts/astudio/validate-dataset.mjs datasets/vision/astudio-v1
```

默认校验检查每行 JSON 对象、已出现的 `vars`/`metadata`/`assert` 基础结构、可识别的重复 ID，以及 `vars` 和断言中的本地 `file://` 文件引用。变量名、答案类型、标签取值、断言类型与阈值均可按数据集扩展。缺少 ID 的行可以通过基础检查。

默认依次从 `id`、`sample_id`、`vars.sample_id`、`metadata.sample_id` 选择每行的 ID，识别到 ID 后检查重复。已有 ID 体系可用规则中的 `idField` 明确指定。

失败时命令返回非零退出码，JSONL 问题显示行号，文件问题显示对应引用。图片内容、题意、参考答案和评分尺度由产品复核，远程图片的可访问性由执行阶段核验。Promptfoo 在运行评测时进一步解析用例配置。

命令也接受任意命名的 JSONL 文件。文件引用默认相对输入文件所在目录，输入数据集目录时默认相对该目录。评测配置另有 `basePath` 时，可显式对齐。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/astudio-v1/cases.jsonl \
  --base-path datasets/vision/astudio-v1
```

### 按数据集配置专项规则

各数据集可以通过独立 JSON 文件声明自己的必填字段、ID 字段及枚举约束。仅在传入 `--rules` 时应用这些约束。以下示例展示自定义字段，保存路径可按实际数据集选择。

```json
{
  "idField": "vars.case_id",
  "requiredFields": ["vars.case_id", "vars.image_path", "vars.query"],
  "allowedValues": {
    "metadata.level": ["基础", "进阶"],
    "assert.0.type": ["equals", "llm-rubric"]
  }
}
```

字段路径通过点号访问嵌套对象与数组。设置 `idField` 后，该字段为必填项。`requiredFields` 检查字段存在及非空字符串，`allowedValues` 同时要求对应字段存在。示例集提供了自己的规则文件，可验证配置方式。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/examples-v1 \
  --rules datasets/vision/examples-v1/validation-rules.json
```

初始空草稿可以用 `--allow-empty` 检查目录。正式评测使用至少一条完成标注的用例。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/astudio-v1 --allow-empty
```

提交评审时附上用例 ID、原图、参考答案依据、能力标签、校验结果，以及本次数据集 Git 提交。正式发布时冻结版本，后续修订在新版本目录中进行，评测结果记录对应版本与提交。
