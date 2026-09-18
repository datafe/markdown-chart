# 分布、矩阵与阶段图

与 [Skill 主入口](../SKILL.md) 和 [ECharts 契约](echarts.md) 一起使用。本页图表都使用
table canonical data；分析过程先准备可直接绘制的数值，series 只用 encode 绑定字段。

| 问题 | 图表 | 必须提前准备 |
| --- | --- | --- |
| 数值分布 | 直方图 | 互斥分桶、桶标签、计数；不要让 renderer 临时分桶 |
| 分位与异常范围 | 箱线图 | min、Q1、median、Q3、max 五数，口径一致 |
| 两变量关系 | 散点 | x、y 数值，可选 size/category |
| 二维强度 | 热力图 | x、y、value 三列，补点规则已确认 |
| 阶段转化 | 漏斗 | 真实阶段顺序和每阶段值，不按数值自动改业务顺序 |
| 多维画像 | 雷达 | 同量纲或已解释量纲、indicator 名称和真实上限 |
| 单值相对区间 | 仪表 | 当前值、业务最小/最大范围和单位 |
| 累计增减 | 瀑布 | 每步基座、增加、减少列；不在 renderer 内累计 |

## 完整示例：已分桶直方图

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["bucket", "count"],
    "source": [["0-9", 12], ["10-19", 28], ["20-29", 17]]
  },
  "spec": {
    "title": {"text": "时长分布（示例数据）"},
    "xAxis": {"type": "category", "name": "分钟"},
    "yAxis": {"type": "value", "name": "会话数"},
    "series": [{"name": "会话数", "type": "bar", "barGap": "0%", "encode": {"x": "bucket", "y": "count"}}]
  }
}
```

## 字段映射要点

- 散点：`encode: {"x":"x_value","y":"y_value","tooltip":[...]}`。
- 热力：`type:"heatmap"`，encode 绑定 x/y/value；坐标轴不再复制 data。
- 饼/环：`type:"pie"`，encode 使用 itemName/value；环图只增加 radius。
- 漏斗：`type:"funnel"`，encode 使用 itemName/value，source 按业务阶段排列。
- 箱线：source 每行包含类别和五数；encode 的 y 指向五数列数组。
- 雷达/仪表若当前 ECharts dataset encode 无法稳定表达，应改用其它受支持图或文字，
  不能把第二份事实写入 `series.data` 绕开单一事实源。
- 瀑布：使用相同 stack 的透明基座、增加、减少三个 bar series，各自 encode 到准备列。

包含多条 line/bar 时执行 validator。任何图若需要猜分桶、分位、阶段顺序、上限或基座，
先回到分析步骤补齐；validator 只能检查字段是否存在，不能证明业务计算正确。
