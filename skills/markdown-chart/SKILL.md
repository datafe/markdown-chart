---
name: markdown-chart
description: >
  使用规范的 markdown-chart 围栏直接生成可筛选数据表、KPI 指标卡（可带迷你趋势与变化对比）或 ECharts 图表。
  适用于明细探索、独立指标、管理摘要、趋势、对比、排名、分布、构成或占比、相关性和异常等可视化有助于理解
  的场景；用户明确要求交互表格、图表、KPI 展示、记分卡、可视化或 ECharts 输出时也应使用。
---

# Markdown 图表

在回答中直接输出图表 JSON。宿主已支持 `markdown-chart`，无需探测渲染器；
本 Skill 定义生成格式，宿主负责解析和渲染。

## 输出契约

- 每张图用独立的 `markdown-chart` 围栏，内容是一个可被 `JSON.parse` 解析的对象。
  设置 `version: 1`、`renderer: "table" | "echarts" | "kpi"`、`data` 和 `spec`。
- 只写 JSON 值。函数、回调、表达式、注释和尾随逗号均不可用；任何层级都不写
  `formatter`，包括字符串模板。格式化能力按所选 renderer 的 reference 使用。
- 数值来自本轮真实数据，数据与配置分离。机器列键使用
  `^[A-Za-z_][A-Za-z0-9_]*$`；标题、图例和轴名称保留用户可读的业务名称。
- 币种、单位和比例尺度来自用户、元数据或已确认的指标定义。未知时保留源值、
  省略未经确认的单位；不要因为字段叫 sales 或用户用中文就假设人民币。
- 简单图直接在最终回答生成，不为出图默认写草稿或调用 validator。
  输出前核对数据、字段映射、单位与正文一致；只有实际执行过校验才声称“已校验”。
- 先给简短结论，再给图表，按需说明口径和限制。图表不嵌套在列表、引用或其它
  代码块中；宿主已有 Chart/Data 切换，通常不再重复整张 Markdown 表格。

## 选型与按需读取

数据足够且可视化有助于理解时默认出图：完整时间序列趋势用折线、比较/排名用柱状、
少量类别构成用饼图、相关性用散点。流向使用桑基，任意关系使用关系图，明确父子
结构使用树/矩形树/旭日。分布先分桶；箱线图需要真实五数。
多指标比较优先分组柱或多折线；双轴只用于不同单位或量级，并标明两侧单位。

- **交互表格**：用户需要查看明细、按列排序筛选、搜索、冻结关键列或导出 CSV 时，
  使用 `renderer: "table"`。生成前读取 [Table 契约](references/table.md)，按其中的
  列类型、格式、变化/条形/进度/sparkline 单元格和受控 ref 规则配置。
- **ECharts**：生成前读取 [ECharts 契约与示例](references/echarts.md)；其中包含最小模板、
  长表处理、多系列映射、组合图和预检要求。
- **分布、矩阵与阶段**：直方、箱线、散点、热力、雷达、仪表、漏斗、瀑布图读取
  [分布与矩阵](references/distribution-and-matrix.md)。
- **流向与关系**：桑基或关系图读取 [Graph 与 Flow](references/graph-and-flow.md)。
  这两类使用 `shape: "graph"`，必须执行 validator。
- **层级**：树、矩形树或旭日图读取 [Hierarchy](references/hierarchy.md)。
  这三类使用 `shape: "hierarchy"`，必须执行 validator。
- **KPI**：展示一个或多个指标的当前值，也支持卡片内的迷你折线/面积趋势和变化对比。
  “当前值 + 近期走势/较上期变化”可用 KPI，不必另画 ECharts；需要完整坐标轴或复杂序列时再用 ECharts。
  生成指标卡（包括带趋势的指标卡）前读取 [KPI 契约](references/kpi.md)，
  按其中的 `trend`、`compare`、时间字段与数据点要求配置；字段绑定、百分比尺度、独立数据集和 Wiki 引用也见该页。

纯定性说明、数据不足或需要猜数时使用普通 Markdown。用户明确只要普通 Markdown
表格时不要替换成交互表格；少量静态值无需排序、筛选或导出时也优先普通 Markdown。
类别/序列过多先聚合或采样，说明处理方式；不为了出图制造比较。结构化图校验通过
只证明信封契约，不证明数据来源、业务口径或线上浏览器展示。

## 先准备 render-ready 数据

`markdown-chart` 只渲染已经准备好的 canonical dataset，不负责数据处理。生成 JSON
之前，由分析过程完成需要的聚合、去重、排序、Top N、分桶、补点、单位换算和 pivot；
renderer、协议和 validator 都不会自动 group by、拆系列或改变事实。graph/hierarchy 的
节点、边、children 和叶子值也必须在分析阶段准备完成。无法可靠准备时改用表格或文字。
