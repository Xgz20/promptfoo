# 视觉模型评测与 Excel 对比报告

本流程使用 Promptfoo 采集单图回答，逐点裁判与几何评分生成单题分，最后导出五个 Sheet。指标依据[图像理解测评指标](https://yf2ljykclb.xfchat.iflytek.com/docx/doxrzQ171Iz0NJ2gYjhOlXka39g)，模型名单依据[视觉模型测评选型](https://yf2ljykclb.xfchat.iflytek.com/docx/doxrzrtQPKEFmhibd19RT8poe1d)，价格读取 [Venus 定价页](https://venus.xunfei.cn/pricing) 使用的公开目录接口。

基于本流程结果撰写的四章选型报告样例见 [AStudio视觉模型选型评测报告（2026年11月10日）](reports/vision-model-selection_20261110_165442.md)，包含结论、整体对比、场景对比和能力对比，可供后续报告生成Skill参考结构与证据口径。

## 五个 Sheet 与计算口径

| Sheet    | 主要内容                                                                                 |
| -------- | ---------------------------------------------------------------------------------------- |
| 整体对比 | 每模型一行，展示总平均分、单任务耗时、token、成本估算、已评题数及调用失败数              |
| 场景对比 | 每模型一行，包含总平均分和各场景平均分，场景列头标明本轮题数                             |
| 能力对比 | 每模型一行，包含总平均分、六项能力正确率及批注完整正确率                                 |
| 用例明细 | 每用例一行，包含用例ID、场景、名称、标准检查点，以及每个模型的百分制总分和逐点0/1得分    |
| 模型单价 | 选型文档中的八个模型，按渠道、上下文档位、时段展示实时 API 的输入/输出/缓存读/缓存写单价 |

总平均分为本轮计划题目最终分之和除以计划题数，全量100题的分母为100。场景平均分按该场景计划题数计算。20%/15%表达当前题集配比，计算总分时直接读取逐题分数。

整体对比、场景对比和能力对比均在模型名称后展示总平均分，并在生成时按未舍入的总平均分降序排列。三个 Sheet 的模型行顺序一致，同分时保留模型清单顺序，N/A 排在有效分数之后。场景与能力 Sheet 的总平均分通过公式引用整体对比 Sheet。能力 Sheet 的总平均分为0～100分，能力列按百分比展示，分别应用对应范围的渐变色。

六项能力分为全部正确检查点数除以全部适用检查点数。检查点正确为1，错误为0。不适用能力保留 N/A。批注完整正确率为所有要求均正确的标准批注数除以标准批注总数。

场景矩阵的渐变色固定映射0、50、100分，能力矩阵固定映射0%、50%、100%，由红到黄再到绿。N/A显示为灰色。当前接口样例每场景1题，列头显示1题；全量运行时按实际题数自动显示20题或15题。

用例明细的检查点同时包含语义点与几何定位点，模型列按相同检查点ID列出0/1判分。坐标x、y合并判定一个定位点。右侧计算辅助列默认隐藏，可取消隐藏核对token、费用与能力计数，主体始终每用例一行。

### 检查点分数如何换算成百分制

每个独立检查点正确得1点，错误得0点。设一题适用检查点总数为N，答对E点，触发额外修改扣分的条数为K。

```text
基础分 = 100 × E / N
最终分 = max(0, 基础分 − 10 × K)
```

例如答对10/11点，基础分为90.91分。未触发扣分时最终分为90.91分；额外修改1条时为80.91分。有批注任务保留既定的额外修改扣分规则。检查点判分保持0/1，百分制换算发生在单题汇总时，计算使用未舍入值。

这一汇总与历史回放中的“六场景等权、逐题能力率平均”分开记录。单题仍复用 `point-mean-v1`，保留原图、题干、Gold、坐标容差和额外修改扣分。新版报告标记为 `vision-selection-report-v1`，避免将不同汇总口径的总分直接比较。

按题平均及分组平均可见 [VQA 官方汇总代码](https://github.com/GT-Vision-Lab/VQA/blob/master/PythonEvaluationTools/vqaEvaluation/vqaEval.py)。按点汇总与先分别计算再平均的区别，与常用 [micro/macro 汇总定义](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.f1_score.html)一致。单题判分规则按当前业务契约确定。

缺少候选回答或裁判结果时保留计划分母，分数显示待完成。候选模型的技术失败按现有单题规则计0分。裁判异常保留待判状态。报告同时展示已评/计划题数，完整性不足时总体分数为 N/A。

参数、鉴权或模型目录错误记录为调用配置异常，修复后重新运行，能力分保持待完成。模型采集前会检查当前密钥的模型访问权限。每个模型可在 `models.json` 的 `parameters` 中设置适用参数，未设置的温度等参数使用服务端默认值。

## 运行前准备

从工程根目录运行，按 `.nvmrc` 使用 Node 并安装依赖。

```bash
source "$HOME/.nvm/nvm.sh"
nvm use
npm ci
```

在本机环境设置 `VENUS_API_KEY`。选择 API 裁判时，再设置 `VISION_JUDGE_API_KEY`。配置文件仅记录环境变量名。

[models.json](../../evals/vision/models.json) 保存八个候选模型及裁判配置。指定裁判使用 `gpt-6.1-sol`，请求参数为 `reasoning_effort: high`，展示名称为 `gpt-6.1-sol/high`。当前指定网关对带 `/high` 的字面模型名返回 `model_not_found`，上述同模型参数形式已通过图片请求验证。

每轮开始时读取 Venus 公开价格目录，保留包含渠道、上下文、时段、币种和截至时间的快照。已入库的 [pricing-snapshot.json](../../evals/vision/pricing-snapshot.json) 用于查看数据格式与来源。运行记录中的价格快照供该轮费用计算使用。

## 采集候选模型回答

完整流水线可用一个命令完成采集、API 裁判和 Excel 导出。

```bash
node scripts/astudio/vision/run-evaluation.mjs --judge-mode api \
  --concurrency 8 --per-model-concurrency 1
```

需要在 Codex 会话完成裁判时，使用 `--judge-mode session`。首次生成判分包及待完成报告，在会话判分完成后，指定同一 `run-dir` 加 `--resume` 导入并刷新 Excel。`--resume` 继续裁判和报告阶段，候选采集使用已有记录。

```bash
node scripts/astudio/vision/run-evaluation.mjs --judge-mode session
node scripts/astudio/vision/run-evaluation.mjs \
  --judge-mode session --run-dir RUN_DIR --resume
```

以下分阶段命令可用于独立排查或只运行流程的一部分。

以下命令执行八模型、100题的全量采集，发起真实模型调用。

```bash
node --import tsx scripts/astudio/vision/evaluate-live.mjs \
  --concurrency 8 --per-model-concurrency 1
```

首次验证可选两个模型、每场景一题。该范围为每模型6题，报告会标为接口验证样本。

```bash
node --import tsx scripts/astudio/vision/evaluate-live.mjs \
  --models doubao/doubao-seed-2.0-mini,qwen/qwen3.8-flash \
  --cases-per-scene 1 --concurrency 4
```

`--concurrency` 控制同时运行的模型数，`--per-model-concurrency` 控制各模型内部的题目并发数，默认分别为4和1。八模型同时运行、各模型串行时使用8和1。每个模型拥有独立的 Promptfoo SDK 进程、数据库和连接池，单个模型处理下一题无需等待其它模型。`run.json` 冻结并发设置、有效模型参数和源码版本，请求记录中的起止时间供实际并发核对。

命令输出本轮 `run_dir`。下文的 `RUN_DIR` 均替换为这个路径。每轮使用独立目录，已有目录需显式指定 `--resume`。候选回答、用量、耗时、请求ID、实际渠道和模型名称保存在 `candidates/`。`promptfoo-candidate-results.json` 索引各模型、各次恢复执行的原生采集结果。

候选采集中断后，可用相同参数恢复。程序核对源码版本、题集、配置与参数，校验已有记录的题目和回答哈希，只调用尚无落盘记录的题目。已记录的技术失败也保留。进程在收到响应后、写入记录前被强制终止的调用可能需要重试，远端是否已计费须以平台账单核对。

```bash
node --import tsx scripts/astudio/vision/evaluate-live.mjs \
  --run-dir RUN_DIR --concurrency 8 --per-model-concurrency 1 --resume
```

`.candidate.lock` 防止同一轮重复启动。异常中止后，如锁仍存在，应先确认该轮父进程和所有模型子进程均已结束，再清理残留锁文件。默认单次请求超时600秒、最大输出8192 token，可通过 `--timeout-ms`、`--max-tokens` 指定并冻结在运行记录中。

候选阶段的原生结果用于执行诊断，最终视觉分数由后续逐点判分生成。模型输入仅包含已核验哈希的原图与完整题干。

### 补跑已记录的调用失败

视觉流程的HTTP响应头等待超时默认600秒，由 `REQUEST_TIMEOUT_MS` 控制。应用层总超时由 `--timeout-ms` 单独控制。两层均需允许目标请求的完整执行时间。传输失败记录保留底层错误码和脱敏后的原因。

新批次保存原始字节的 `dataset-cases.jsonl` 快照，补跑、裁判和报告优先读取该快照并核验原哈希。历史批次需要从其 `source_revision` 恢复相同字节的快照，恢复后应校验 `cases_sha256`。图片、题干和Gold继续按原记录中的哈希核验。

```bash
node scripts/astudio/vision/retry-candidates.mjs \
  --run-dir RUN_DIR --model zhipu/glm-5.3-flash \
  --cases canvas-010,poster-012,poster-014 --timeout-ms 600000
node scripts/astudio/vision/judge-run.mjs --run-dir RUN_DIR --mode api --concurrency 3
```

补跑按题串行执行，沿用原模型和输出参数。原调用归档到 `candidate-attempts/`，新响应先暂存，再原子替换当前候选记录，随后重新裁判。成功记录再次运行会跳过，发布中断后可复用已暂存的响应。同一轮的候选和裁判锁共同保护补跑过程。

模型、输入、生成参数和评分契约一致时，可对指定失败题补跑并重新评分，再汇总该模型100题结果。报告保留初次版本与全部历史尝试，当前对比表标记补跑题数。`--capture-response` 保存完整脱敏响应。已有同参数诊断回答可通过 `--reuse-diagnostic DIR` 复用，导入时核验模型、参数、输入哈希、原始响应和usage，并记录来源。

### 输出预算的解释

出现截断或空回答时，可以先抽样诊断并保存完整响应。以下命令沿用原批次模型、题目与生成参数，将HTTP响应体、脱敏后的响应头、`reasoning_content`、原始 `content` 结构和usage保存到独立目录，正式候选记录继续作为原配置的基线。

```bash
node scripts/astudio/vision/diagnose-candidates.mjs \
  --run-dir RUN_DIR --model xiaomi/mimo-v2.6-pro \
  --cases canvas-004,poster-014 --output-dir .local/vision-diagnostics/mimo-32k
```

每次诊断使用新目录，响应逐题保存。HTTP响应读到一半失败时保留已接收的片段，并标记完整性与JSON解析状态。调整输出预算或思考配置后，另开正式评测版本，完整重评该模型的全部题目。

当前采集流程显式发送 `max_tokens`，命令行默认8192，本次正式批次为32768。该值表达生成上限。支持推理的接口可能将思考token与最终答案共同计入该预算，具体语义以渠道实现为准。

统一预算适合比较既定资源条件下的效果、成本和延迟。以模型推荐配置开展选型时，应冻结各模型的有效输出预算及思考设置，并单列截断率。省略参数后由SDK、网关或供应商决定有效默认值，默认值与模型最大输出容量分别核对。视觉评测框架VLMEvalKit也在模型配置中分别设置输出预算，例如部分推理模型为16384、部分模型为32768。来源见 [VLMEvalKit配置](https://github.com/open-compass/VLMEvalKit/blob/main/vlmeval/config.py) 与 [Inspect生成配置](https://inspect.aisi.org.uk/reference/inspect_ai.model.html#generateconfig)。

相同字段的限制范围也需核对。[百炼OpenAI兼容Chat文档](https://docs.modelstudio.console.alibabacloud.com/zh/model-studio/qwen-api-via-openai-chat-completions)说明，`max_tokens` 对部分模型限制思考与回答之和，对其它模型仅限制回答。`max_completion_tokens` 则限制总生成量。经过Venus路由时，还需核实其参数转换后再声明预算等价。

## 在 Codex 客户端会话中完成裁判

当前会话可以读取本地原图、候选回答及标准检查点，输出逐点判断。该方式适合人工协作核验，判分过程通过结构化文件交接。

采集阶段已导出 `RUN_DIR/session-judge/`。需要重新生成时执行以下命令。

```bash
node scripts/astudio/vision/judge-run.mjs --run-dir RUN_DIR --mode export
```

在 Codex 会话提供下面的任务说明，填入实际路径。

```text
请作为视觉评测裁判，阅读 RUN_DIR/session-judge/README.md，
逐个打开 requests/ 中的请求和 image_path 指向的原图。
依据原图、原问题及标准检查点核对 answer，每点只给0或1，并给出依据。
保留 case_id、answer_sha256、gold_sha256。
结果保存到相同相对文件名的 decisions/ 中，完成后标记 status 为 complete。
无法核对的题保留 pending，并说明需要补充的证据。
```

已完成判分的文件示例如下，哈希和检查点从实际请求复制。

```json
{
  "status": "complete",
  "case_id": "canvas-001",
  "answer_sha256": "从请求复制",
  "gold_sha256": "从请求复制",
  "checkpoints": [{ "id": "实际检查点ID", "credit": 1, "reason": "回答证据及原图核对依据" }],
  "extra_edits": [],
  "reviewer": "Codex 客户端会话"
}
```

导入后，程序核对哈希、检查点集合和二值判分，再计算几何与汇总分。

```bash
node scripts/astudio/vision/judge-run.mjs --run-dir RUN_DIR --mode session
```

客户端会话登录和通用模型 API 分属不同使用入口，见[官方认证说明](https://learn.chatgpt.com/docs/auth)。这里通过本地判分包衔接会话操作。自动化任务使用下面的 API 裁判入口。

## 使用 API 裁判

```bash
node scripts/astudio/vision/judge-run.mjs \
  --run-dir RUN_DIR --mode api --concurrency 3
```

API 裁判接收原图、问题、原子标准及原始回答。程序从可信 Gold 填充检查点含义，裁判提供每点的0/1判断和依据。精确坐标由程序计算。判分记录绑定答案和Gold的SHA-256。

API裁判总超时默认600秒，可通过裁判配置中的 `timeout_ms` 覆盖，有效值记录在判分来源中。

判分成功的记录存入 `reviews/`，可重跑裁判阶段补齐剩余项。已有记录会先经哈希与评分契约检查。异常记录写入对应的 `.error.json`，并在汇总中显示待裁判。判分过程中使用 `.judge.lock` 防止同一轮并行写入。进程异常中止后，应确认该轮裁判进程已结束，再清理残留锁文件。

## 费用与性能

单题估算成本按四类用量分别计价，单价单位为人民币元/百万token。当前Venus OpenAI Chat返回的缓存读写token属于输入token的组成部分。

```text
普通输入token = 输入token − 缓存读token − 缓存写token
单题成本 = (普通输入token × 普通输入单价
          + 缓存读token × 缓存读单价
          + 缓存写token × 缓存写单价
          + 输出token × 输出单价) / 1000000
单题平均成本 = 本轮各题成本之和 / 计划题数
```

每题根据实际渠道、请求时间与输入档位匹配价格。缺少用量或价格时保留N/A。补跑后，对比表统计当前候选结果所对应请求的成本，原失败尝试单独归档，历史失败用量缺失时，全部实际支出需通过平台账单核对。

- 耗时使用每次候选请求从发出到完整响应的时长。并发执行时按各题请求时长求平均。
- 输入、输出、总token使用接口返回的用量。输出token包含接口已计入的推理token。
- 成本依据实际返回渠道、调用时间和输入长度匹配实时按量价。普通输入先扣除已单独计价的缓存读、缓存写token，再分别相乘求和。
- 缺失用量、缺失已使用项的价格、渠道匹配不唯一时，成本保持 N/A。明确的零价或零用量保留为零。
- API返回的 `usage.cost` 单独保留在原始记录中。对比表统一展示标准公开价估算，便于横向比较，账单核对使用平台实际账单。
- 裁判调用的token和耗时保存在判分来源记录中，候选模型的性价比列使用候选请求数据。

## 导出 Excel

Excel 生成使用 Artifact Tool，默认查找 Codex 随附运行时。其它运行环境通过 `ASTUDIO_ARTIFACT_RUNTIME` 指定包含其 `node_modules` 的 Node 运行时目录。

报告文件名带北京时间的生成时间戳，格式为 `视觉模型评测报告_YYYYMMDD_HHmmss.xlsx`，精确到秒。同一轮重新生成时使用新的生成时间。同秒重名时追加递增序号，例如 `_2`、`_3`。`--output` 用于指定目录和名称前缀，实际文件名仍追加时间戳，以命令返回的 `output` 路径为准。

```bash
node scripts/astudio/vision/report-xlsx.mjs --run-dir RUN_DIR

# 指定交付路径
node scripts/astudio/vision/report-xlsx.mjs --run-dir RUN_DIR \
  --output RUN_DIR/outputs/视觉模型评测报告.xlsx
```

导出前将 Excel 公式结果与独立汇总核对，扫描公式错误。整体与场景分数按逐题表计算，能力分按正确数/适用总数计算，成本公式引用单价Sheet。修改已匹配的单价后，对应成本随公式重新计算。

报告同时生成 `report-data.json`，逐题统计由 `judge-run.mjs` 写入 `scored-results.jsonl`。题目、Gold和原始回答的哈希保持可追溯，所有运行产物保存在 `.local/`。
