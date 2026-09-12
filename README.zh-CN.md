# Markdown Chart

<p align="center">
  <strong>面向 Markdown 的安全、流式图表渲染方案。</strong><br />
  将严格 JSON 代码块渲染为可交互的 ECharts 图表和响应式 KPI 卡片。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@datafe-open/markdown-chart"><img alt="npm 版本" src="https://img.shields.io/npm/v/@datafe-open/markdown-chart?color=4f46e5"></a>
  <a href="https://github.com/datafe/markdown-chart/actions/workflows/release.yml"><img alt="发布状态" src="https://github.com/datafe/markdown-chart/actions/workflows/release.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/github/license/datafe/markdown-chart"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

<p align="center">
  <img src="./docs/images/markdown-chart-kpi.png" alt="Markdown Chart 渲染响应式多 KPI 卡片组" width="960" />
</p>

`markdown-chart` 是一个小巧、易于接入不同前端框架的 Markdown 图表工具包，
尤其适合渲染 AI 或数据应用仍在流式输出的 Markdown。它让原始数据保持可查看，
让图表配置可以跨宿主传递，也让渲染器与 Markdown 解析链路彼此解耦。

## 为什么选择 Markdown Chart？

- **为流式 Markdown 设计。** 已闭合的图表代码块会立即渲染，并在后续文本
  继续到达时保持挂载。
- **数据默认可查看。** 标准协议将数据与渲染器配置分离，自动提供图表/数据
  切换和有边界的表格视图。
- **适合承接生成内容。** 文档输入只接受严格 JSON，不执行 JavaScript，
  并对 schema、大小和图表配置设置明确限制。
- **直接接入常见技术栈。** 提供 React + react-markdown、Vue 3 + markdown-it
  组件，也可以只使用与框架无关的核心包。
- **同时覆盖图表和指标卡。** 内置相互独立的 ECharts 与响应式多 KPI 渲染器。
- **可扩展但不绑定宿主。** 可以注册其它渲染器、解析应用自有数据引用，
  或由宿主处理引用点击事件。

## 快速开始

### React + react-markdown

```sh
pnpm add echarts @datafe-open/markdown-chart-react
```

````tsx
import { MarkdownChart } from '@datafe-open/markdown-chart-react';

const source = `## 月度销售额

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["month", "sales"],
    "source": [["1 月", 100], ["2 月", 180], ["3 月", 260]]
  },
  "spec": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar", "encode": { "x": "month", "y": "sales" } }]
  }
}
\`\`\``;

export function Report() {
  return <MarkdownChart source={source} />;
}
````

这个组件会自动配置 react-markdown、ECharts 和 KPI 渲染器。如果应用已经管理
Markdown 解析器或渲染器注册表，请参考 [React 高级示例](./examples/react/advanced/)。

### Vue 3 + markdown-it

```sh
pnpm add echarts @datafe-open/markdown-chart-vue
```

```vue
<script setup lang="ts">
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';

defineProps<{ source: string; streaming?: boolean }>();
</script>

<template>
  <MarkdownChart :source="source" :streaming="streaming" />
</template>
```

Vue 组件会自动配置 markdown-it 和同一组内置渲染器。完整可运行工程见
[简单与高级示例](./examples/)。

## 可以渲染什么？

### ECharts 图表

使用 `renderer: "echarts"`，通过与渲染器无关的 `data` 提供数据，以严格 JSON
ECharts `spec` 提供图表配置。显式 ECharts 配置会覆盖项目的展示默认值。
Inline 数据以及由宿主 resolver 返回的引用数据都会自动获得图表/数据切换能力。

### 多 KPI 卡片

使用 `renderer: "kpi"` 展示包含 1–12 个指标的响应式卡片组。每个 KPI 可以从
共享或具名数据集中绑定值，使用结构化 `Intl.NumberFormat` 配置格式化数值，
展示语义状态与折线/面积趋势，并按需暴露由宿主处理的引用入口。

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "source": [
      { "day": "2026-09-01", "conversion": 0.38, "revenue": 16800000 },
      { "day": "2026-09-02", "conversion": 0.42, "revenue": 18000000 }
    ]
  },
  "spec": {
    "timeField": "day",
    "items": [
      {
        "id": "conversion",
        "title": "转化率",
        "value": { "field": "conversion", "format": { "style": "percent" } },
        "trend": { "type": "area", "compare": { "lag": 1, "mode": "absolute" } }
      },
      {
        "id": "revenue",
        "title": "营收",
        "value": {
          "field": "revenue",
          "format": { "style": "currency", "currency": "CNY", "notation": "compact" }
        }
      }
    ]
  }
}
```
````

## 流式渲染

在 token 仍在到达时，把外层文档状态传给组件：

```tsx
<MarkdownChart source={source} streaming={isStreaming} />
```

```vue
<MarkdownChart :source="source" :streaming="isStreaming" />
```

代码块一旦闭合就会立即渲染。只有文档末尾尚未闭合的活动代码块会继续等待；
解析、数据解析或图表运行时挂载尚未完成时，会展示内置 loading 状态。

## 由宿主管理的数据与操作

标准数据既可以直接 inline，也可以使用 `dataset://forecast` 这类不透明引用。
项目本身不会选择传输方式，也不会主动请求引用；宿主负责校验引用并提供 resolver。
KPI 引用入口遵守同一边界：渲染器只转发不透明事件，由宿主决定是否以及如何打开。

因此，应用的数据访问、鉴权、页面跳转和领域协议都留在公共渲染器之外。

## 包说明

| 包 | 用途 |
| --- | --- |
| [`@datafe-open/markdown-chart`](https://www.npmjs.com/package/@datafe-open/markdown-chart) | 与框架无关的注册表、标准解析器、数据视图和生命周期控制器 |
| [`@datafe-open/markdown-chart-echarts`](https://www.npmjs.com/package/@datafe-open/markdown-chart-echarts) | 严格 JSON ECharts 渲染器 |
| [`@datafe-open/markdown-chart-kpi`](https://www.npmjs.com/package/@datafe-open/markdown-chart-kpi) | 响应式多 KPI 渲染器 |
| [`@datafe-open/markdown-chart-markdown-it`](https://www.npmjs.com/package/@datafe-open/markdown-chart-markdown-it) | markdown-it 占位插件和环境通道 |
| [`@datafe-open/markdown-chart-react`](https://www.npmjs.com/package/@datafe-open/markdown-chart-react) | React + react-markdown 组件和适配器 |
| [`@datafe-open/markdown-chart-vue`](https://www.npmjs.com/package/@datafe-open/markdown-chart-vue) | Vue 3 + markdown-it 组件和 composable |

## 文档

- [协议规范](./SPEC.md)
- [安全模型与支持的 ECharts 配置范围](./SECURITY.md)
- [可运行示例](./examples/)
- [React 包接入指南](./packages/react/README.md)
- [Vue 包接入指南](./packages/vue/README.md)
- [发布流程](./RELEASING.md)

## 本地开发

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check:pack
```

欢迎提交 Issue 和 Pull Request。可发布包的变更使用 Changesets；根目录构建也会
验证全部 React 和 Vue 示例。

## 许可证

MIT。部分实现改编自采用 Apache-2.0 许可证的 Qwen Code，详见
[第三方声明](./THIRD_PARTY_NOTICES.md)。
