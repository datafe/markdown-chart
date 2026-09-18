# ECharts 示例

与 [Skill 主入口](../SKILL.md) 一起使用。所有示例都是严格 JSON；
单位换算和百分比计算在数据层完成，option 不执行函数。

## 最小合法示例

所有事实放在 `data.source`，每个 series 用 `encode` 绑定字段；
宿主注入 dataset，不写 `spec.dataset`、`xAxis.data` 或 `series.data`。
ECharts 内联数据使用二维数组，行宽与 dimensions 一致。

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["day", "orders"],
    "source": [["周一", 120], ["周二", 200], ["周三", 150]]
  },
  "spec": {
    "title": { "text": "每日订单量" },
    "tooltip": { "trigger": "axis" },
    "xAxis": { "type": "category" },
    "yAxis": { "type": "value", "name": "订单数" },
    "series": [
      { "name": "订单数", "type": "bar", "encode": { "x": "day", "y": "orders" } }
    ]
  }
}
```

| 展示需求 | 合法表达 |
| --- | --- |
| 元显示为亿元 | 数据层计算新数值列，轴名称标明“亿元”，保留原值供核对 |
| 百分比 | ECharts 数值列先确定为 0–100 百分比尺度，单位写在轴名称或系列名称 |
| 数值标签 | `"label": { "show": true }`；需要指定列时用 `encode.label` |
| tooltip | `"tooltip": { "trigger": "axis" }`；用 `encode.tooltip` 选择列 |
| 按类别配色 | 顶层 `color` 数组 + 柱系列 `colorBy: "data"` |
| 类别轴 | 由 dataset + encode 提供，不重复设置 axis.data |

不要把 KPI 的 `value.format` 写进 ECharts option。不要生成 `eval`、脚本、
DOM/网络访问、`renderItem`、custom series、HTML tooltip 或 dataset transform。
受控数据引用只使用宿主提供的真实 ref，不能虚构 URL 或本地文件引用。

## 金额与占比双轴图

输入元信息已确认 GMV 单位为人民币元。原始金额保留在 total_gmv，
展示列 gmv_yi = total_gmv / 100000000；gmv_pct 是总量占比乘以 100。
series.encode 指向实际存在的字段，GMV 与占比分别绑定左右轴。
下面使用简化教学数据；实际回答必须替换为本轮数据，不能照抄数值。

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["channel", "total_gmv", "gmv_yi", "gmv_pct"],
    "source": [
      ["PC", 600000000, 6, 40],
      ["APP", 525000000, 5.25, 35],
      ["小程序", 375000000, 3.75, 25]
    ]
  },
  "spec": {
    "title": { "text": "各渠道 GMV 与占比" },
    "legend": { "top": 30 },
    "grid": { "top": 80, "bottom": 40, "containLabel": true },
    "color": ["#5470c6", "#91cc75", "#fac858"],
    "tooltip": { "trigger": "axis" },
    "xAxis": { "type": "category" },
    "yAxis": [
      { "type": "value", "name": "GMV（亿元）", "min": 0 },
      { "type": "value", "name": "占比（%）", "min": 0, "max": 100 }
    ],
    "series": [
      {
        "name": "GMV（亿元）", "type": "bar", "colorBy": "data",
        "encode": { "x": "channel", "y": "gmv_yi", "label": "gmv_yi", "tooltip": ["gmv_yi"] },
        "label": { "show": true, "position": "top" }
      },
      {
        "name": "占比（%）", "type": "line", "yAxisIndex": 1,
        "encode": { "x": "channel", "y": "gmv_pct", "label": "gmv_pct", "tooltip": ["gmv_pct"] },
        "itemStyle": { "color": "#333333" },
        "label": { "show": true, "position": "top" }
      }
    ]
  }
}
```

金额和对应占比由同一组数据决定时，单柱图加正文占比往往已经足够；
用户要求组合图时再使用双轴。不要通过截断柱状图数值轴夸大微小差异。
显示精度由计算结果列控制，单位放在轴或系列名称中，不添加 formatter。

## 长表转多系列宽表

多系列图的 `data.source` 必须已经是 chart-ready 数据。分析过程负责聚合和 pivot；
ECharts renderer 不会把「横轴维度、系列维度、度量」长表按系列维度的取值自动拆成多条系列。
`encode.seriesName` 也不是 group by。若把多个同类型 series 绑定到相同的 canonical x/y，
每个 series 都会读取同一批长表行，同一横轴值下的多个度量值可能被连接。

下面是先透视后再渲染的完整示例：

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["period", "segment_a", "segment_b"],
    "source": [
      ["P1", 120, 80],
      ["P2", 150, 95]
    ]
  },
  "spec": {
    "title": { "text": "分组指标趋势" },
    "legend": { "top": 30 },
    "tooltip": { "trigger": "axis" },
    "xAxis": { "type": "category" },
    "yAxis": { "type": "value", "name": "指标值" },
    "series": [
      {
        "name": "A", "type": "line",
        "encode": { "x": "period", "y": "segment_a" }
      },
      {
        "name": "B", "type": "line",
        "encode": { "x": "period", "y": "segment_b" }
      }
    ]
  }
}
```

两个及以上 line/bar 系列都要显式填写唯一 `series.name`。相同类型的系列不能重复
绑定同一组 canonical x/y；不同类型的 line + bar 可以共享指标形成组合图。

## 横向排名与饼图字段映射

同一个 dataset 可按方向映射；类别名称仍保存在数据行中：

- 横向柱：xAxis.type="value"，yAxis.type="category"，
  series.encode={"x":"amount","y":"category"}。类别轴不写 data。
- 饼图：series.type="pie"，series.encode={"itemName":"category","value":"amount"}。
- 中文业务名用 series.name、title.text、轴 name 展示；维度键使用英文机器键。
- 标签绑定使用 encode.label，tooltip 绑定使用 encode.tooltip，不复制数据进 series。

## 常见趋势与比较

- 面积图仍使用 `type: "line"`，增加 `areaStyle: {}`；事实只在 table source 中。
- 分组柱使用多个 bar series；堆叠柱/面积为同一比较组设置相同 `stack`。
- 百分比堆叠先按已确认分母在分析层计算 0–100 数值，不让 renderer 临时归一化。
- 横向柱交换 x/y encode，并设置 `xAxis.type="value"`、`yAxis.type="category"`。
- 柱线组合可共享 x/y 事实；单位或量级不同才使用 `yAxisIndex` 双轴。
- 多系列都要有唯一可读 `name`，encode 必须指向真实 dimensions；不要用多条 series
  重复读取同一个长表 x/y 假装已经拆系列。

直方、箱线、散点、热力、漏斗、雷达、仪表和瀑布图的 chart-ready 数据要求见
[分布与矩阵](distribution-and-matrix.md)。graph/hierarchy 不使用本页 table encode，分别读取
[Graph 与 Flow](graph-and-flow.md) 和 [Hierarchy](hierarchy.md)。

## 较大数据与引用

先聚合、排序、分桶或采样，并在正文说明。只有宿主已提供真实且可解析的
artifact:// 或 session-file:// 引用时使用 data.kind="ref"，同时写入真实 ref、
format（csv 或 json）及已知 dimensions。不生成虚构引用，不让图表自行发网络请求。
ECharts 只使用一个规范数据集；不输出顶层 datasets、spec.dataset 或 transform。

## 预检与修复

包含两个及以上 line/bar 系列或任何 graph/hierarchy 时，必须将完整信封用文件工具写入可写目录并执行
validator。其它复杂配置不确定、修复已有坏图或用户明确要求预检时也执行；
单系列简单已知格式可以按需执行。命令如下（将 Base directory 替换为加载本 Skill 的实际目录）：

```bash
node "<Base directory>/scripts/validate_chart.mjs" "chart-draft.json"
```

根据错误路径修改并重试一次；仍失败时改用表格/文字说明。校验通过后使用该草稿，
不要在最终输出中重新添加未经校验的格式化配置。工具不可用时保留简单已知格式；
无法可靠表达的图表降级为表格/文字。对于两个及以上 line/bar 系列，validator 不可用
也必须降级，不能跳过门禁输出未经校验的多系列图。
