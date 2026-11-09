# 视觉模型评测与 Excel 对比报告

本流程使用 Promptfoo 采集单图回答，逐点裁判与几何评分生成单题分，最后导出五个 Sheet。指标依据[图像理解测评指标](https://yf2ljykclb.xfchat.iflytek.com/docx/doxrzQ171Iz0NJ2gYjhOlXka39g)，模型名单依据[视觉模型测评选型](https://yf2ljykclb.xfchat.iflytek.com/docx/doxrzrtQPKEFmhibd19RT8poe1d)，价格读取 [Venus 定价页](https://venus.xunfei.cn/pricing) 使用的公开目录接口。

## 五个 Sheet 与计算口径

| Sheet    | 主要内容                                                                                 |
| -------- | ---------------------------------------------------------------------------------------- |
| 整体对比 | 每模型一行，展示总平均分、单任务耗时、token、成本估算、已评题数及调用失败数              |
| 场景对比 | 每模型一行，场景作为列头并标明本轮题数，单元格仅展示场景平均分                           |
| 能力对比 | 每模型一行，六项能力及批注完整正确率作为列头，单元格仅展示正确率                         |
| 用例明细 | 每用例一行，包含用例ID、场景、名称、标准检查点，以及每个模型的百分制总分和逐点0/1得分    |
| 模型单价 | 选型文档中的八个模型，按渠道、上下文档位、时段展示实时 API 的输入/输出/缓存读/缓存写单价 |

总平均分为本轮计划题目最终分之和除以计划题数，全量100题的分母为100。场景平均分按该场景计划题数计算。20%/15%表达当前题集配比，计算总分时直接读取逐题分数。

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
node scripts/astudio/vision/run-evaluation.mjs --judge-mode api --concurrency 4
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
node --import tsx scripts/astudio/vision/evaluate-live.mjs --concurrency 4
```

首次验证可选两个模型、每场景一题。该范围为每模型6题，报告会标为接口验证样本。

```bash
node --import tsx scripts/astudio/vision/evaluate-live.mjs \
  --models doubao/doubao-seed-2.0-mini,qwen/qwen3.8-flash \
  --cases-per-scene 1 --concurrency 4
```

命令输出本轮 `run_dir`。下文的 `RUN_DIR` 均替换为这个路径。每轮使用独立目录，已有目录会被拒绝，以便明确区分重复运行。候选回答、用量、耗时、请求ID、实际渠道和模型名称保存在 `candidates/`，Promptfoo 原生采集结果保存在 `promptfoo-candidate-results.json`。

候选阶段的原生结果用于执行诊断，最终视觉分数由后续逐点判分生成。模型输入仅包含已核验哈希的原图与完整题干。

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

判分成功的记录存入 `reviews/`，可重跑裁判阶段补齐剩余项。已有记录会先经哈希与评分契约检查。异常记录写入对应的 `.error.json`，并在汇总中显示待裁判。判分过程中使用 `.judge.lock` 防止同一轮并行写入。进程异常中止后，应确认该轮裁判进程已结束，再清理残留锁文件。

## 费用与性能

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
