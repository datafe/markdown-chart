# 标准 Waterfall（瀑布图）

先读 [ECharts 契约](echarts.md) 和 [涨跌语义色](semantic-colors.md)。使用 `renderer:"echarts"`
和 table canonical dataset；ECharts 没有原生 `series.type:"waterfall"`，必须用以下堆叠 bar 模板。
不新增 renderer、shape 或回调。数据由分析过程计算，renderer 不自动累计。

## 数据准备

按业务顺序排列。设上一步余额为 S，本步变化为 d，新余额 E=S+d：

- 增减行：`balance=E`，`base=min(S,E)`；`increase=max(d,0)`、`decrease=max(-d,0)`、`total=0`。
- 期初/小计/期末行：`base=increase=decrease=0`、`total=balance`，允许负合计。
  期初初始化一次；小计与期末是当前余额的快照，不重复累加，也不重置后续余额。
- 保留 `kind/change/balance`；合计行 change 为 null。辅助数值列的 inactive 槽用 **0**，
  不用 null 或 `"-"`（ECharts 的 null + stackStrategy:all 会破坏负基座堆叠）。
  原始未知值不等于零；缺失事实时先补齐口径或改用文字。
- 每个可见系列绑定独立标签列：增加 `+40`，减少 `−180`，负合计 `−40`；非本系列标签
  为 null。零变化在 increase_label 写 `"0"`，使用中性色，不能把未知量当零。

## 渲染约束

四个 bar 共用 `stack:"waterfall"` 且全部设置 `stackStrategy:"all"`，覆盖全负和跨零。
透明基座必须 silent、tooltip/label 关闭、emphasis disabled；可见柱使用方角。
图例只列增加/减少/合计，`selectedMode:false` 防止隐藏某系列后累计坐标重排。
使用 item tooltip，增减柱 encode 绑定有符号 change 与 balance；合计仅绑定 balance。
不要把 abs(delta) 柱高或基座当作变化值显示，不加 formatter。数据标签用中性文本色。

## 完整中文示例

示例事实：100 → +40 → −180 → 小计 −40 → +70 → 期末 30；实际输出换成本轮真实数据。
中文红涨绿跌。英文输出翻译标题/图例/类别，增加改绿 `#138a55`、减少改红 `#d93025`，
总计仍为蓝；不要改变计算所得事实。

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["step", "kind", "change", "balance", "base", "increase", "decrease", "total", "increase_label", "decrease_label", "total_label"],
    "source": [
      ["期初", "total", null, 100, 0, 0, 0, 100, null, null, "100"],
      ["收入", "change", 40, 140, 100, 40, 0, 0, "+40", null, null],
      ["成本", "change", -180, -40, -40, 0, 180, 0, null, "−180", null],
      ["小计", "total", null, -40, 0, 0, 0, -40, null, null, "−40"],
      ["回收", "change", 70, 30, -40, 70, 0, 0, "+70", null, null],
      ["期末", "total", null, 30, 0, 0, 0, 30, null, null, "30"]
    ]
  },
  "spec": {
    "title": {"text": "标准瀑布：跨零与小计（示例数据）"},
    "legend": {"data": ["增加", "减少", "合计"], "selectedMode": false},
    "tooltip": {"trigger": "item"},
    "xAxis": {"type": "category"},
    "yAxis": {"type": "value"},
    "series": [
      {"name": "基座", "type": "bar", "stack": "waterfall", "stackStrategy": "all", "itemStyle": {"color": "transparent", "opacity": 0, "borderWidth": 0, "borderRadius": 0}, "encode": {"x": "step", "y": "base"}, "silent": true, "tooltip": {"show": false}, "label": {"show": false}, "emphasis": {"disabled": true}},
      {"name": "增加", "type": "bar", "stack": "waterfall", "stackStrategy": "all", "itemStyle": {"color": "#d93025", "borderRadius": 0}, "encode": {"x": "step", "y": "increase", "itemName": "step", "tooltip": ["change", "balance"], "label": "increase_label"}, "label": {"show": true, "position": "top", "color": "#687386"}},
      {"name": "减少", "type": "bar", "stack": "waterfall", "stackStrategy": "all", "itemStyle": {"color": "#138a55", "borderRadius": 0}, "encode": {"x": "step", "y": "decrease", "itemName": "step", "tooltip": ["change", "balance"], "label": "decrease_label"}, "label": {"show": true, "position": "bottom", "color": "#687386"}},
      {"name": "合计", "type": "bar", "stack": "waterfall", "stackStrategy": "all", "itemStyle": {"color": "#2563eb", "borderRadius": 0}, "encode": {"x": "step", "y": "total", "itemName": "step", "tooltip": ["balance"], "label": "total_label"}, "label": {"show": true, "position": "outside", "color": "#687386"}}
    ]
  }
}
```

## 输出前验证

将最终候选 JSON 保存为临时文件，运行 `node <skill目录>/scripts/validate_chart.mjs <候选.json>`，
修复错误后再输出同一份内容。瀑布图有四个 bar，必须执行此预检。
再人工核对每步起止余额、负合计、跨零、符号和语言配色；validator 通过不证明累计正确。
Data 视图包含原始语义列和绘图辅助列，保持单一事实源可检查。
