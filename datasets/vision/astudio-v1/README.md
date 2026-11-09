# AStudio 视觉选型评测集 v1

六场景100题迁入本目录作为首批实际选型样本。原图、原题干、Gold、响应schema和评分规则保持不变，不重新造题、不拆成更多题。一题是一张图片及其完整提示词，可包含多个内容小问和定位小问。

本批仍为产品评测集草稿。迁移校验验证文件和评分接入一致性，不代替题意复核或模型能力的人工确认。后续运行应记录对应 Git 提交。

## 场景与题号

| 场景             | 原题号            | 题数 | 分集                               | 文字/箭头批注 | 原版本      |
| ---------------- | ----------------- | ---: | ---------------------------------- | ------------- | ----------- |
| 设计画布与图示   | canvas-001～020   |   20 | [canvas.jsonl](canvas.jsonl)       | 45条          | 0.4.3-draft |
| 网页与应用截图   | webapp-001～020   |   20 | [webapp.jsonl](webapp.jsonl)       | 40条          | 1.0.1       |
| 日常照片         | photo-001～015    |   15 | [photos.jsonl](photos.jsonl)       | 无            | 1.0.2       |
| 海报、插画与漫画 | poster-001～015   |   15 | [posters.jsonl](posters.jsonl)     | 无            | 1.0.1       |
| 统计图表         | chart-001～015    |   15 | [charts.jsonl](charts.jsonl)       | 无            | 1.0.2       |
| 文档与票据       | document-001～015 |   15 | [documents.jsonl](documents.jsonl) | 无            | 1.0.1       |

总集为 [cases.jsonl](cases.jsonl)，一行一个原生 Promptfoo TestCase。六个分集是总集的精确子集，不作为额外题数。

## 文件与字段

- `images/<题号>.png`：100张原尺寸题图；`prompts/<题号>.txt`：100份完整原题干。
- `gold/<题号>.json`：原参考事实、原子评分点、批注规则及几何依据。
- `contracts/<场景>/`：原manifest、响应schema和已有contract，保留原字节。
- `manifest.json`：场景配比、原文件来源、版本与SHA-256。
- `validation-rules.json`：本批ID、字段和场景约束；`promptfooconfig.json`：默认仅本地历史答案回放。

沿用 `vars.case_id`，在 `metadata.case_id` 和 `metadata.sample_id` 中重复记录，便于原记录对照与通用校验器识别。包装版本 `metadata.dataset_version` 为 `astudio-v1`；各场景原版本保留在 `metadata.source_dataset_version` 中。

`vars.image` 为 `file://images/<题号>.png`，`vars.question` 为 `file://prompts/<题号>.txt`，均相对本目录。配置也在本目录，SDK以本目录作为绝对 `basePath`。只有题干和图片进入模型消息，Gold和评分元数据只供评分器读取。

保留 `scene`、`scene_name`、`group`、`has_annotations`；`applicable_dimensions` 直接来源于原Gold/manifest，没有重新推测难度。原contract中的pilot路径仅作来源记录，实际加载使用JSONL路径。原素材来源和许可信息随Gold保留，迁入指定公司评测仓库不改变原素材许可。

## 评分与覆盖

| 维度                   | 名义权重 | 适用题数 |
| ---------------------- | -------: | -------: |
| 文字识别               |       20 |       79 |
| 对象属性与状态识别     |       20 |      100 |
| 空间布局与连接关系识别 |       15 |      100 |
| 批注目标识别           |       15 |       40 |
| 批注意图理解           |       20 |       40 |
| 精确坐标定位           |       10 |      100 |

单题按适用维度的原子项得分率加权，除以适用权重之和，归一到100分。不适用维度为N/A；批注题额外修改仍每条扣10分，最低0分。格式、schema和ID完整性仅作诊断，不以格式通过代替语义正确。

前两场景判断目标框内代表点或折线距离；后四场景判断可见外接框中心，容差为20个最终输入像素。归一化坐标先还原到最终输入尺寸，不混用两种定位规则。

批注完整正确率按85条标准批注统计：同一批注的目标、全部意图和坐标同时正确才算完整正确。共享意图在原归属处计分一次，但影响所有显式引用它的批注。后四场景此指标为N/A。整题完整正确要求全部适用维度正确，且没有额外修改扣分。

综合主分先求各场景均分，再对六场景等权平均；Promptfoo默认跨100题平均仅作辅助指标。单维度得分率按其适用题等权平均。实现见 [score.mjs](../../../scripts/astudio/vision/score.mjs) 与 [aggregate.mjs](../../../scripts/astudio/vision/aggregate.mjs)。

## 本地验证

所有命令从工程根目录运行，按 `.nvmrc` 使用Node 24.22.2。基础与哈希校验只依赖Node，克隆后可直接执行。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/astudio-v1
node scripts/astudio/validate-dataset.mjs datasets/vision/astudio-v1 \
  --rules datasets/vision/astudio-v1/validation-rules.json
node scripts/astudio/vision/verify-dataset.mjs

# 安装工程依赖后运行专项测试，不需要模型答案或凭证
npm ci
npm test -- test/astudio --maxWorkers=2
```

校验覆盖300份原图、题干、Gold，以及schema、场景manifest、版本、分集与能力分布。冻结的 `gold/` 和 `contracts/` 排除自动格式化，防止无意改变原字节。

## 历史答案回放

模型答案、逐项判分、原报告、运行日志和新报告均在 `.local/vision-astudio-v1/`，不进入Git。可从上一阶段已验证的 `eval-harness` 导出导入：

```bash
node scripts/astudio/import-vision-pilot.mjs \
  /实际路径/eval-harness/integrations/promptfoo-vision

# 用当前仓库源码加载JSONL并回放全部200份答案
node --import tsx scripts/astudio/vision/replay.mjs

# 同一配置也可通过本地CLI运行
npm run local -- eval \
  -c datasets/vision/astudio-v1/promptfooconfig.json \
  --no-cache --no-share -o .local/vision-astudio-v1/cli-results.json
```

导入工具读取源导出的 `dataset/`、`replay-data/` 及所属旧仓库的原运行记录/报告，校验哈希后复制，源目录不变。导入完成后回放不再读取旧仓库。只需验证题库时不需要导入历史答案。

`replay.mjs` 独立重算几何、六维分、批注完整性和汇总，与原报告及六场景总览对照。语义判断沿用历史记录，必须匹配答案和Gold哈希，未重新调用模型或裁判。浮点绝对容差 `1e-9`；差异、缺题和框架错误均令脚本失败。报告为 `.local/vision-astudio-v1/index.html`，逐题数据为同目录 `verification.json` 和 `scored-results.jsonl`。

历史基线：DeepSeek六场景等权89.2935、整题全对33/100、批注完整36/85；Sol分别为100、100/100、85/85。语义记录仍为助手初评，未经本次迁移新增人工复核。两者执行通道不同，不将分差全部归因于基础模型。

消息构造器恢复框架加载文本时去掉的首尾空白，并核对实际消息中的题干和图片哈希。回放入口禁止网络传输，拦截框架的“已关闭遥测”通知；CLI直接运行保留框架默认遥测行为。均未修改框架源码。

## 后续运行新模型

JSONL和消息构造器可复用于新provider，使用用户指定的模型与裁判配置。当前默认仅回放历史记录，没有配置在线调用。新答案需要自己的逐项语义判断和证据；当前评分入口会拒绝没有匹配语义记录的答案，不套用旧分数。新的语义评审接入需要另外配置，不能用格式、关键词或历史判断替代。

题图、题干或Gold变更后需要重新构建版本、复核并更新判分记录，不能继续宣称与旧答案可直接对照。新增方法见[产品维护指南](../../../docs/astudio/datasets.md)。
