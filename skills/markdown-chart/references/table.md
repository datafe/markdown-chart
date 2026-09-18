# Table 契约

与 [Skill 主入口](../SKILL.md) 一起使用。需要保留明细并让用户直接排序、筛选、搜索或
导出时使用 `renderer: "table"`。只有少量静态值且无需交互时继续使用普通 Markdown 表格；
需要突出总体趋势、比较或构成时使用 ECharts，需要摘要指标时使用 KPI。

## 数据

- `data` 只能是 table shape；省略 `shape` 即表示 table。
- 小型内联数据优先使用对象行，字段使用稳定 ASCII 机器键。数组行必须提供
  `dimensions`，并与每行顺序一致。单元格只能是字符串、有限数值、布尔值或 null。
- 只有宿主已提供真实 `artifact://` 或 `session-file://` 资源时才能使用
  `kind: "ref"`。同时写真实 `ref`、可选 `format: "csv" | "json"` 以及已知的
  `dimensions`。不能虚构 ref、URL 或本地路径；公共 renderer 不取数、不鉴权，宿主
  resolver 负责验证并返回行数据。
- 默认最多 10,000 行、200,000 个物化单元格。没有显式 columns 时，自动推断字段最多
  50 个。数据超过预算时优先使用真实 ref；若宿主没有 ref，先聚合或缩小结果并说明。

## spec

`spec` 支持：

- `title`：可选标题；`height`：240–720，默认 420。
- `columns`：1–50 列。源列使用 `field`；标题放在 `title`。可选 `type` 为
  `string | number | date | boolean`，也可配置 `width`（72–600）、`pinned`、
  `sortable` 和 `filter`。
- 日期不会自动推断。日期列必须显式使用 `type: "date"`，值使用 ISO 日期或带时区的
  ISO timestamp；可配置 `format.dateStyle: "short" | "medium" | "long"`。
- 数值格式使用 `format.style: "decimal" | "percent" | "currency" | "unit"`。
  `currency` 必须来自已确认的 ISO 4217 币种，`percent` 与数据尺度必须匹配；还可使用
  `notation`、小数位数、`prefix`、`suffix` 和 `nullDisplay`。
- `cell.kind: "change"` 展示涨跌方向并配置 `polarity`；`bar` 和 `progress` 可配置
  `min`、`max`、`clamp`。这些 cell 只用于数值列。
- sparkline 是派生列：设置唯一 `id`，并在 `cell` 中配置 `kind: "sparkline"`、
  2–50 个数值 `fields`、可选等长 `labels` 和 `scale: "column" | "row"`。
- `initialSort` 包含 1–3 个 `{ "field", "direction": "asc" | "desc" }`；只能引用
  columns 中可排序的源字段，不能引用 sparkline 派生列。

## 完整内联示例

```markdown-chart
{
  "version": 1,
  "renderer": "table",
  "data": {
    "kind": "inline",
    "source": [
      {"region": "华东", "sales": 1280000, "growth": 0.18, "target": 0.91, "apr": 31, "may": 36, "jun": 42},
      {"region": "华南", "sales": 960000, "growth": -0.04, "target": 0.74, "apr": 27, "may": 26, "jun": 25}
    ]
  },
  "spec": {
    "title": "区域经营明细",
    "height": 420,
    "columns": [
      {"field": "region", "title": "区域", "pinned": "left"},
      {"field": "sales", "title": "销售额", "type": "number", "format": {"style": "currency", "currency": "CNY", "notation": "compact"}},
      {"field": "growth", "title": "同比", "type": "number", "format": {"style": "percent"}, "cell": {"kind": "change", "polarity": "higher-is-better"}},
      {"field": "target", "title": "目标完成", "type": "number", "format": {"style": "percent"}, "cell": {"kind": "progress", "min": 0, "max": 1, "clamp": true}},
      {"id": "trend", "title": "近三月", "cell": {"kind": "sparkline", "fields": ["apr", "may", "jun"], "labels": ["4月", "5月", "6月"], "scale": "column"}}
    ],
    "initialSort": [{"field": "sales", "direction": "desc"}]
  }
}
```

## 受控 ref 示例

只有下列 ref 已由宿主实际提供时才输出：

```markdown-chart
{
  "version": 1,
  "renderer": "table",
  "data": {
    "kind": "ref",
    "ref": "artifact://analysis/region-performance.json",
    "format": "json",
    "dimensions": ["region", "sales", "growth"]
  },
  "spec": {
    "title": "区域经营明细",
    "columns": [
      {"field": "region", "title": "区域", "pinned": "left"},
      {"field": "sales", "title": "销售额", "type": "number"},
      {"field": "growth", "title": "同比", "type": "number", "format": {"style": "percent"}, "cell": {"kind": "change", "polarity": "higher-is-better"}}
    ]
  }
}
```

包含自定义 cell、日期格式、派生 sparkline 或 initialSort 时执行 validator。校验通过只
证明输出契约与已内联数据一致，不证明 ref 可访问、宿主已升级、数据口径或线上展示。
