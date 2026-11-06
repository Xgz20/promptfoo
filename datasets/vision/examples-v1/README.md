# 单图评测结构示例

版本为 `examples-v1`。四条用例及图片复用已完成的工程 POC，覆盖 OCR、图表读取、目标计数和空间关系，用于演示字段、评分规则和文件引用。实际模型选型使用产品维护的 `astudio-v1` 及后续正式版本。

| 用例 ID             | 图片                           | 参考答案 | 能力               |
| ------------------- | ------------------------------ | -------- | ------------------ |
| `demo_ocr_0001`     | `images/demo_ocr_0001.png`     | `128.50` | `text_recognition` |
| `demo_chart_0001`   | `images/demo_chart_0001.png`   | `Q3`     | `chart_reading`    |
| `demo_count_0001`   | `images/demo_count_0001.png`   | `3`      | `object_counting`  |
| `demo_spatial_0001` | `images/demo_spatial_0001.png` | `right`  | `spatial_relation` |

图片为合成素材，已保留原始字节。`metadata.source` 标记为 `synthetic_poc`，便于追溯示例用途。

从工程根目录运行以下命令，预期校验通过，显示 4 条用例、4 张图片。

```bash
node scripts/astudio/validate-dataset.mjs datasets/vision/examples-v1
```
