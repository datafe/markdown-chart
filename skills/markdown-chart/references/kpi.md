# KPI 契约与示例

与 [Skill 主入口](../SKILL.md) 的通用输出契约一起使用；本页只在生成 KPI 时读取。

## KPI 输出契约

KPI 记分卡必须使用以下严格的顶层结构：

```json
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "source": [{ "metric_a": 1, "metric_b": 2 }]
  },
  "spec": {
    "items": [
      {
        "id": "metric_a",
        "title": "指标 A",
        "value": { "field": "metric_a", "reduce": "lastNonNull" }
      },
      {
        "id": "metric_b",
        "title": "指标 B",
        "value": { "field": "metric_b", "reduce": "lastNonNull" }
      }
    ]
  }
}
```

KPI 块采用规范的数据与配置分离方式。默认事实放在 `data` 中；其他具名事实放在
顶层 `datasets` 中；`spec` 只包含数据集或字段映射、格式、趋势、状态和引用配置。
绝不能把最终展示值直接写入 `spec`。遵循以下规则：

- 包含 1-12 个条目。支持单条目 KPI 块；下方完整示例刻意使用至少 2 个条目，以体现
  常见记分卡。每个 `id` 必须唯一并匹配
  `^[A-Za-z][A-Za-z0-9_-]{0,63}$`。
- 当 KPI 条目的粒度、筛选条件和来源相同时，使用一个共享的宽表 `data` 数据集。
  每行代表一个时间点，每个条目绑定一个数值或文本列。`spec.timeField` 是共享
  时间列。趋势数据应提前按时间升序准备；渲染器保留输入行顺序。
- 当粒度、筛选条件或来源不同时，把每个额外的 ChartData 对象放在顶层
  `datasets` 中，使用匹配以下规则的唯一机器键：
  `^[A-Za-z][A-Za-z0-9_-]{0,63}$`，再把条目的 `dataset` 设置为该键。
  未指定 `dataset` 的条目读取默认 `data`。多个条目可以选择同一个具名数据集。
- 正常生成的 `data` 和 `datasets.*` 值使用 `kind: "inline"`。内联数据集可以包含
  对象行，或包含唯一机器键 `dimensions` 的数组行。只有已有 `artifact://` 或
  `session-file://` 资源才能使用 `kind: "ref"`；不要虚构 ref。已知维度时应包含它们。
- `value` 是一个对象，必填 `field`，可选 `reduce: "lastNonNull"` 和 `format`。
  默认 reducer 为 `lastNonNull`。不要使用条目级 `prefix` 或 `suffix`。
- `format.style` 只能是 `text`、`decimal`、`percent`、`currency` 或 `unit`。
  可以安全指定 `currency`、`unit`、`notation`、最小或最大小数位数、`prefix`、
  `suffix` 和 `nullDisplay`。百分比格式必须与下方所示的源数据尺度一致。
  绝不能输出函数、JavaScript formatter 或表达式。
- 数值格式化使用经过校验的 `Intl.NumberFormat('en-US', options)` 子集。`currency`
  必须提供已确认的大写 ISO 4217 代码；`unit` 必须提供受支持的 `Intl.NumberFormat`
  单位标识符。渲染器固定使用 `currencyDisplay: "narrowSymbol"` 和
  `unitDisplay: "short"`；`locale`、`currencyDisplay`、`unitDisplay` 以及其他未列出的
  Intl 选项都不是可接受字段。`prefix`、`suffix` 和 `nullDisplay` 是渲染器提供的
  展示选项，不是 Intl 选项。币种格式化不会执行跨币种金额换算。
- 可选的 `status.text` 和 `status.tone` 分别绑定字段或字面量，例如
  `{ "text": { "field": "status_text" }, "tone": { "literal": "negative" } }`。
  tone 值只能是 `neutral`、`positive`、`warning` 或 `negative`。
- 可选的 `trend` 使用 `type: "line"` 或 `"area"`。它默认使用条目的 value 字段和
  共享的 `spec.timeField`，也可覆盖字段或时间。使用 `compare` 表示精确的行滞后
  `absolute` 或 `relative` 变化；业务含义明确时应显式声明 `polarity`。
  `yScale.includeZero` 可选。可用数值点少于两个时，自动降级为不带迷你趋势图的
  KPI；需要完整坐标轴或复杂序列时改用 ECharts。
- 可选的 `references` 为该 KPI 包含 1-3 个互不重复的 `{ "ref", "label" }` 对象。
  不要添加空的 references 数组。
- 用户可见字符串必须符合文档规定的长度限制，不得包含换行或控制字符。`spec`
  及其每个嵌套配置对象都会拒绝未知字段。趋势数据最多 500 行；所有已选数据集
  合计最多 2,000 行、40,000 个单元格。

### 趋势数据准备示例

KPI 趋势同样遵守主入口的 chart-ready 规则。输入前完成业务粒度的聚合、排序和必要的
宽表转换，使每个条目在每个时间点只有一个指标值。`lastNonNull` 取输入顺序中最后一个
非空值，不代表自动求和或按时间找最新值；`compare.lag` 按行偏移，不按日历寻找上一天。
缺失日期不能默认补零；只有业务口径确认无记录即为零时才补零，否则保留缺失并说明，
不要把跨日期的上一行标为“较昨日”。比例指标需按定义先聚合分子、分母后计算。

例如已确认以下记录是互不重叠的渠道订单计数，目标是每日总订单量：

```text
day         channel  orders
2026-09-02  A        90
2026-09-01  A        60
2026-09-02  B        60
2026-09-01  B        40
```

分析过程先按日求和并升序排列，得到 `2026-09-01: 100`、`2026-09-02: 150`。
然后生成如下配置；示例数值仅用于说明，实际输出使用本轮数据：

```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "dimensions": ["day", "daily_orders"],
    "source": [["2026-09-01", 100], ["2026-09-02", 150]]
  },
  "spec": {
    "timeField": "day",
    "items": [{
      "id": "daily_orders",
      "title": "每日订单量",
      "value": {
        "field": "daily_orders",
        "format": { "style": "decimal", "suffix": "单" }
      },
      "trend": {
        "type": "line",
        "compare": { "lag": 1, "mode": "relative", "label": "较昨日" }
      }
    }]
  }
}
```

预期主值为 `150单`，趋势为 `100 → 150`，较昨日增加 `50%`。
此处 `lag: 1` 能表示昨日，是因为输入确实为相邻两天。若目标是分渠道 KPI，
则先形成每个渠道独立的数值列并分别绑定条目，不能把渠道明细串成同一条趋势。

### 百分比尺度示例

选择 `value.format` 前，先根据查询计算或指标定义确认尺度。`percent` 会把输入乘以
100；带 `%` 后缀的 `decimal` 则保留已经放大过的百分比。保留源数据尺度并使用
匹配的格式：

| 源数据含义 | 示例值 | `value.format` | 展示结果 |
| --- | --- | --- | --- |
| 比例 | `0.9189` | `{ "style": "percent", "minimumFractionDigits": 2, "maximumFractionDigits": 2 }` | `91.89%` |
| 已乘以 100 的百分比 | `91.89` | `{ "style": "decimal", "minimumFractionDigits": 2, "maximumFractionDigits": 2, "suffix": "%" }` | `91.89%` |

例如，查询返回的准时交付率和延迟交付率已经乘以 100。保留这些数值，只附加百分号，
不要再次缩放：

```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "dimensions": ["ontime_rate_pct", "late_rate_pct"],
    "source": [[91.89, 8.11]]
  },
  "spec": {
    "items": [
      {
        "id": "ontime_rate",
        "title": "准时交付率",
        "value": {
          "field": "ontime_rate_pct",
          "format": { "style": "decimal", "minimumFractionDigits": 2, "maximumFractionDigits": 2, "suffix": "%" }
        }
      },
      {
        "id": "late_rate",
        "title": "延迟交付率",
        "value": {
          "field": "late_rate_pct",
          "format": { "style": "decimal", "minimumFractionDigits": 2, "maximumFractionDigits": 2, "suffix": "%" }
        }
      }
    ]
  }
}
```

预期展示结果为 **91.89%** 和 **8.11%**，与上下文说明一致。如果对这些已缩放数值
应用 `percent`，则会错误展示为 `9,189%` 和 `811%`。应根据指标定义判断尺度，
不能根据字段名或数值是否大于 1 判断：增长比例 `1.25` 合理的展示结果就是 `125%`。
仅靠 Schema 校验无法确定指标尺度；输出前应将格式化后的 KPI 与源计算及文字说明核对。

### 混合指标示例

本示例中，源数据元信息确认营收币种为 CNY，订单量的单位为订单计数（使用后缀
`单` 展示）。这些都不是默认单位。

```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "dimensions": [
      "day",
      "conversion_rate",
      "cumulative_revenue",
      "order_volume",
      "store_inventory",
      "inventory_status",
      "inventory_tone"
    ],
    "source": [
      ["2026-08-31", 0.38, 16800000, 6800000, "24/48", "库存偏低", "warning"],
      ["2026-09-01", 0.4, 18000000, 7200000, "23/48", "低于安全水平", "negative"]
    ]
  },
  "spec": {
    "timeField": "day",
    "items": [
      {
        "id": "conversion_rate",
        "title": "转化率",
        "value": {
          "field": "conversion_rate",
          "format": { "style": "percent", "maximumFractionDigits": 0 }
        },
        "status": {
          "text": { "literal": "低于目标" },
          "tone": { "literal": "negative" }
        },
        "trend": {
          "type": "area",
          "compare": {
            "lag": 1,
            "mode": "absolute",
            "label": "较昨日",
            "polarity": "higher-is-better"
          }
        }
      },
      {
        "id": "cumulative_revenue",
        "title": "累计营收",
        "value": {
          "field": "cumulative_revenue",
          "format": {
            "style": "currency",
            "currency": "CNY",
            "notation": "compact",
            "maximumFractionDigits": 1
          }
        },
        "trend": {
          "type": "line",
          "compare": {
            "lag": 1,
            "mode": "relative",
            "label": "较昨日",
            "polarity": "higher-is-better"
          }
        }
      },
      {
        "id": "order_volume",
        "title": "订单量",
        "value": {
          "field": "order_volume",
          "format": { "style": "decimal", "notation": "compact", "suffix": "单" }
        }
      },
      {
        "id": "store_inventory",
        "title": "门店库存",
        "value": { "field": "store_inventory", "format": { "style": "text" } },
        "status": {
          "text": { "field": "inventory_status" },
          "tone": { "field": "inventory_tone" }
        }
      }
    ]
  }
}
```

KPI 条目需要独立结果时，数据名称与证据名称必须清晰区分。本示例同样假设源数据
元信息已确认营收币种为 CNY：

```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "source": [{ "revenue": 18000000 }]
  },
  "datasets": {
    "inventory": {
      "kind": "inline",
      "source": [
        { "day": "2026-08-31", "stock": 24 },
        { "day": "2026-09-01", "stock": 23 }
      ]
    }
  },
  "spec": {
    "items": [
      {
        "id": "revenue",
        "title": "累计营收",
        "value": { "field": "revenue", "format": { "style": "currency", "currency": "CNY" } }
      },
      {
        "id": "inventory",
        "title": "门店库存",
        "dataset": "inventory",
        "value": { "field": "stock" },
        "trend": { "type": "line", "timeField": "day" }
      }
    ]
  }
}
```

### KPI Wiki 来源

当前 `ada-knowledgebase-query finalize` 结果支持某个 KPI 时，把对应文档的
`citation` 原样复制到 `references[].ref`，并把 `displayLabel` 原样复制到
`references[].label`。只能使用针对当前用户问题 finalize 的文档。
`references[].label` 最多接受 120 个 Unicode 码点，且不得包含控制字符或行分隔符；
如果 finalize 后的 `displayLabel` 超出这一展示边界，应省略该 KPI 的 `references`，
而不是修改 label。没有对应的 finalized 文档时，也省略该 KPI 的 `references`。
绝不能自行构造、规范化、缩短或复用上一轮的 Wiki URI。

KPI 引用控件只是额外入口，不能替代回答中的证据。在每个实际采纳点（包括解释 KPI
定义时），仍须按照 `ada-knowledgebase-query` 的要求，把每篇被采纳文档当前完整的
`citationMarkdown` 原样复制到周围文字中。

KPI Wiki 引用示例；两个值必须来自当前同一份 finalize 文档：

```json
{
  "references": [
    {
      "ref": "kb-wiki://wiki/kb_01M06TNAJERSPD2MXQSW937DCJ/versions/v20260804-120000-ab12cd34/files/metrics/conversion-rate.md#calculation-logic",
      "label": "转化率 / Calculation Logic"
    }
  ]
}
```
