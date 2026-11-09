# AStudio 单图理解评测集

产品用例与原图在这里一起维护。每个版本目录包含 `README.md`、`cases.jsonl` 和 `images/`。

| 目录                                 | 用途                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| [astudio-v1](astudio-v1/README.md)   | 六场景100题：保留原题、六维评分和批注完整正确率，产品评测集草稿 |
| [examples-v1](examples-v1/README.md) | 四条合成图片示例，用于学习结构和验证导入                        |

新增用例前阅读 [产品维护指南](../../docs/astudio/datasets.md)。Codex 的操作约定见 [AGENTS.md](AGENTS.md)。

从工程根目录验证示例集，只需要 Node.js。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/examples-v1
```
