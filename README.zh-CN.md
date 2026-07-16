# Markdown Chart

[English](./README.md) | 简体中文

> [!IMPORTANT]
> **预发布状态：** `@datafe/markdown-chart*` 目前尚未发布到 npm。下文安装命令描述的是计划发布的公开接口；首次发布前请克隆本仓库并运行本地示例。维护者请参阅[发布流程](./RELEASING.md)。

`markdown-chart` 为流式 Markdown 提供可移植的图表代码块，支持查看原始数据和接入不同的图表渲染器。核心包与框架无关，也不依赖任何聊天产品。

项目首先提供 ECharts 渲染器，以及 markdown-it、Vue 3 和 react-markdown 适配器。基于注册表的核心设计可以继续接入 Plotly、Vega 或其他渲染器包，无需在核心包中添加针对具体图表库的分支判断。

## 包

| 包 | 用途 |
| --- | --- |
| `@datafe/markdown-chart` | 渲染器注册表、标准 `markdown-chart` 路由和生命周期控制器 |
| `@datafe/markdown-chart-echarts` | 仅接受严格 JSON 的 ECharts 渲染器 |
| `@datafe/markdown-chart-markdown-it` | 输出安全占位节点，并通过 markdown-it env 收集图表块的插件 |
| `@datafe/markdown-chart-vue` | Vue 3 组件和 composable |
| `@datafe/markdown-chart-react` | react-markdown 的 `code`/`pre` 适配器 |

## 标准 Markdown 格式

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["month", "sales"],
    "source": [["Jan", 100], ["Feb", 180]]
  },
  "spec": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar", "encode": { "x": "month", "y": "sales" } }]
  }
}
```
````

协议只有一个 `version`，位于最外层的 `markdown-chart` 协议对象中。`data` 与渲染器无关，因此宿主应用可以独立展示 inline 数据，例如提供“查看数据”操作。`spec` 属于选定的渲染器，不再重复保存数据或版本号。

宿主应用无需加载图表运行时，也可以读取标准格式中的数据：

```sh
pnpm add @datafe/markdown-chart
```

```ts
import { parseMarkdownChartEnvelope } from '@datafe/markdown-chart';

// chartFenceBody 是 markdown-chart 代码块内部的 JSON 文本。
const { data } = parseMarkdownChartEnvelope(chartFenceBody);
if (data?.kind === 'inline') {
  showDataTable(data.dimensions, data.source);
}
```

渲染器专属代码块仍然可以作为简写使用。ECharts 包支持 `echarts`，也支持迁移别名 `echarts-fulldata`：

````markdown
```echarts
{
  "xAxis": { "type": "category", "data": ["A", "B"] },
  "yAxis": {},
  "series": [{ "type": "bar", "data": [10, 20] }]
}
```
````

## React + react-markdown

假设前面的标准 Markdown 已保存在 `source` 中：

```sh
pnpm add echarts @datafe/markdown-chart-react
```

```tsx
import { MarkdownChart } from '@datafe/markdown-chart-react';

export function App({ source }: { source: string }) {
  return <MarkdownChart source={source} />;
}
```

## Vue 3 + markdown-it

```sh
pnpm add echarts @datafe/markdown-chart-vue
```

```vue
<script setup lang="ts">
import { MarkdownChart } from '@datafe/markdown-chart-vue';

defineProps<{ source: string }>();
</script>

<template>
  <MarkdownChart :source="source" />
</template>
```

两个组件都会自动注册 ECharts，在首次挂载图表时加载运行时，并自动设置 360px 的最小高度。标准格式中的 inline 数据还会自动启用基于图标的 `Chart / Data` 切换和有边界、可滚动的数据表格。卡片、工具栏、图标、表格，以及 ECharts 的默认色板、坐标轴、tooltip 和系列样式均改编自 [Qwen Code WebShell 实现](https://github.com/QwenLM/qwen-code/blob/89ab15d2f1bc253d4375e508130462ad5df3c56f/packages/web-shell/client/components/messages/EchartsFullDataBlock.tsx)；Markdown 中显式设置的 ECharts option 仍然优先。React 包自带 `react-markdown`，Vue 包自带 `markdown-it`。只有默认行为不能满足需求时，才需要传入自定义 `registry`、解析器、主题或渲染器选项。归因信息见[第三方声明](./THIRD_PARTY_NOTICES.md)。

宿主应用可以通过 `--markdown-chart-background`、`--markdown-chart-subtle-background` 和 `--markdown-chart-accent` 对齐卡片颜色。高级模式可以设置 `createEChartsRenderer({ defaultStyle: false })` 关闭展示样式默认值；安全校验、标准 data 注入和 data ref 解析仍然会执行。

## 流式渲染

把外层 Markdown 文档的流式状态传给框架组件：

```tsx
<MarkdownChart source={source} streaming={isStreaming} />
```

```vue
<MarkdownChart :source="source" :streaming="isStreaming" />
```

已经闭合的图表代码块会立即渲染；后续文本继续到达时，已挂载的图表实例会保持不变。只有末尾仍未闭合、正在输出的代码块会等待更多输入。React 高级模式把相同状态传给 `MarkdownChartProvider`，Vue 高级模式则传给 `MarkdownChart`。

## 高级配置

只有在添加新渲染器或解析宿主数据时，才需要创建并传入注册表：

```ts
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';

const registry = new ChartRendererRegistry();
registry.register(createEChartsRenderer({
  resolveDataRef: async (ref, meta) => loadApplicationDataset(ref, meta.signal),
}));
```

把同一个实时注册表传给框架适配器。之后注册的渲染器别名，例如 `vega-lite` 或 `plotly`，无需更新适配器的语言列表即可被识别。包本身不会获取数据引用，允许哪些引用协议由应用决定。

### 接入已有的 react-markdown 应用

如果宿主应用已经管理外层 Markdown 渲染器，仍然可以使用 Provider 和 components API。使用上面配置好的 `registry`，接入方式如下：

```tsx
import ReactMarkdown from 'react-markdown';
import {
  MarkdownChartProvider,
  createMarkdownChartComponents,
} from '@datafe/markdown-chart-react';

const chartComponents = createMarkdownChartComponents({
  chartStyle: { minHeight: 360 },
});

<MarkdownChartProvider registry={registry} streaming={isStreaming}>
  <ReactMarkdown components={chartComponents}>{source}</ReactMarkdown>
</MarkdownChartProvider>
```

Provider 会从直接子节点 `ReactMarkdown` 中推断 `source`，因此在这种常见的高级接入方式中，启用流式渲染不需要再增加一个必填属性。

在这种模式下，应用应把所有直接导入的包声明为应用依赖：

```sh
pnpm add echarts react-markdown \
  @datafe/markdown-chart \
  @datafe/markdown-chart-echarts \
  @datafe/markdown-chart-react
```

### 接入已有的 Vue + markdown-it 应用

Vue 应用可以保留已有的 markdown-it 实例，并把同一个注册表传给插件和组件：

```vue
<script setup lang="ts">
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe/markdown-chart-vue';
import MarkdownIt from 'markdown-it';

defineProps<{ source: string; isStreaming: boolean }>();

const registry = new ChartRendererRegistry().register(createEChartsRenderer());
const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
  registry,
});
</script>

<template>
  <MarkdownChart
    :source="source"
    :streaming="isStreaming"
    :markdown-it="markdownIt"
    :registry="registry"
  />
</template>
```

把这个高级示例直接导入的包声明为应用依赖：

```sh
pnpm add echarts markdown-it \
  @datafe/markdown-chart \
  @datafe/markdown-chart-echarts \
  @datafe/markdown-chart-markdown-it \
  @datafe/markdown-chart-vue
```

更多内容请参阅 [SPEC.md](./SPEC.md)、[SECURITY.md](./SECURITY.md) 以及 Vue 和 React [示例](./examples/)。简单模式和高级模式位于相互独立的可运行目录中，各自拥有独立的依赖清单。

## 开发

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check:pack
```

根目录构建会同时验证所有可发布包，以及四个 React/Vue Vite 示例。示例 workspace 均为私有包，不会包含在 npm 包产物中。发布包变更使用 Changesets 管理，首次发布和自动发布步骤见[发布流程](./RELEASING.md)。

## 许可证

MIT。部分实现改编自采用 Apache-2.0 许可证的 Qwen Code，详见[第三方声明](./THIRD_PARTY_NOTICES.md)。
