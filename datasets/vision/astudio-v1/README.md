# AStudio 视觉选型评测集 v1

版本为 `astudio-v1`，当前处于草稿阶段。产品新增的实际评测用例放入本目录。

`cases.jsonl` 初始为空。每个用例在文件中占一行，输入图片放入 `images/`。`metadata.dataset_version` 填写 `astudio-v1`。

新增方法和标注约定见 [产品维护指南](../../../docs/astudio/datasets.md)，完整示例见 [examples-v1](../examples-v1/README.md)。

新增实际用例后，从工程根目录运行校验。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/astudio-v1
```

正式评测前完成题意和标注复核，并记录冻结的 Git 提交。冻结时在本说明中更新状态，后续内容调整使用新版本目录。
